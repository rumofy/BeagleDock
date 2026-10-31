import { useEffect, useMemo, useRef, useState } from "react";
import { LiveShell } from "../../components/LiveShell";
import { useApp } from "../../hooks/AppStateProvider";
import {
  buildShellTabs,
  DEFAULT_AUTO_CLOSE_SECONDS,
  splitVisibleTabs,
  tabsToAutoClose,
  type TabClock,
} from "../../lib/shellTabs";
import type { ChatEvent } from "../../types";

const ALL = "all";

const dot = (status: "running" | "done" | "error") =>
  status === "running"
    ? "bg-amber-400 animate-pulse"
    : status === "error"
      ? "bg-rose-500"
      : "bg-emerald-500";

/**
 * Shell da conversa: a aba "Tudo" mantém o fluxo único de sempre e, quando comandos ou agentes
 * rodam em paralelo, cada um ganha a própria aba. Abas novas nunca tomam o foco; só ganham uma
 * marca quando recebem saída que você ainda não viu.
 */
export function SessionShell({ sessionId }: { sessionId: string }) {
  const { currentSession, currentMessages, settings } = useApp();
  const autoClose = settings.shellAutoClose !== false;
  const autoCloseSeconds = settings.shellAutoCloseSeconds ?? DEFAULT_AUTO_CLOSE_SECONDS;
  const [selected, setSelected] = useState(ALL);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const seen = useRef<Record<string, number>>({});
  const clocks = useRef<Record<string, TabClock>>({});
  const [, bump] = useState(0);

  useEffect(() => {
    setSelected(ALL);
    setClosed(new Set());
    seen.current = {};
    clocks.current = {};
  }, [sessionId]);

  const events = useMemo(
    () => currentMessages.flatMap((message) => message.events ?? []) as ChatEvent[],
    [currentMessages],
  );
  // Fechar uma aba só a esconde: a saída continua em "Tudo". Comando em execução não fecha.
  const tabs = useMemo(
    () => buildShellTabs(currentSession?.shellRaw, events).filter((tab) => !closed.has(tab.id)),
    [currentSession?.shellRaw, events, closed],
  );
  const finished = tabs.filter((tab) => tab.status !== "running");
  const closeTabs = (ids: string[]) => setClosed((prev) => new Set([...prev, ...ids]));
  const activeTab = tabs.find((tab) => tab.id === selected);
  const current = activeTab ? selected : ALL;

  // Relógio de cada aba: quando terminou e a última vez que esteve aberta.
  useEffect(() => {
    const now = Date.now();
    for (const tab of tabs) {
      const clock = (clocks.current[tab.id] ??= {});
      if (tab.status === "running") delete clock.finishedAt;
      else clock.finishedAt ??= now;
      if (tab.id === selected) clock.viewedAt = now;
    }
  }, [tabs, selected]);

  // Auto-close: confere de tempos em tempos; erro, aba aberta e saída não vista nunca fecham.
  useEffect(() => {
    if (!autoClose) return;
    const timer = setInterval(() => {
      const ids = tabsToAutoClose(tabs, clocks.current, {
        now: Date.now(),
        seconds: autoCloseSeconds,
        selectedId: selected === ALL ? null : selected,
        seenSizes: seen.current,
      });
      if (ids.length) closeTabs(ids);
    }, 5000);
    return () => clearInterval(timer);
  }, [autoClose, autoCloseSeconds, tabs, selected]);

  // O que está aberto conta como visto.
  useEffect(() => {
    if (activeTab && seen.current[activeTab.id] !== activeTab.size) {
      seen.current[activeTab.id] = activeTab.size;
      bump((n) => n + 1);
    }
  }, [activeTab]);

  const raw = currentSession?.ptyRaw || (currentSession?.ptyLog || []).join("\r\n");
  const text = activeTab ? (currentSession?.shellRaw?.[activeTab.id] ?? "") : raw;
  const { visible, overflow } = splitVisibleTabs(tabs, activeTab ? activeTab.id : null);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {tabs.length >= 1 && (
        <div
          role="tablist"
          aria-label="Shells da conversa"
          data-testid="shell-tabs"
          className="flex items-center gap-1 px-2 py-1 bg-[#1e1e21] border-b border-[#2e2e33] overflow-x-auto"
        >
          <button
            role="tab"
            aria-selected={current === ALL}
            onClick={() => setSelected(ALL)}
            className={`shrink-0 px-2 py-0.5 rounded text-[11px] font-mono ${current === ALL ? "bg-[#3f3f46] text-white" : "text-[#a1a1aa] hover:bg-[#2e2e33]"}`}
          >
            Tudo
          </button>
          {visible.map((tab) => {
            const unseen = current !== tab.id && (seen.current[tab.id] ?? 0) < tab.size;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={current === tab.id}
                onClick={() => setSelected(tab.id)}
                title={tab.agent ? `${tab.agent} › ${tab.label}` : tab.label}
                className={`shrink-0 max-w-[180px] flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono ${current === tab.id ? "bg-[#3f3f46] text-white" : "text-[#a1a1aa] hover:bg-[#2e2e33]"}`}
              >
                <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${dot(tab.status)}`} />
                <span className="truncate">{tab.label}</span>
                {unseen && (
                  <span aria-label="saída nova" className="w-1.5 h-1.5 shrink-0 rounded-full bg-sky-400" />
                )}
                {tab.status !== "running" && (
                  <span
                    role="button"
                    aria-label={`Fechar a aba ${tab.label}`}
                    title="Fechar a aba (a saída continua em Tudo)"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (current === tab.id) setSelected(ALL);
                      closeTabs([tab.id]);
                    }}
                    className="shrink-0 -mr-1 px-1 rounded hover:bg-[#52525b] text-[#a1a1aa] hover:text-white"
                  >
                    ×
                  </span>
                )}
              </button>
            );
          })}
          {finished.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (activeTab && activeTab.status !== "running") setSelected(ALL);
                closeTabs(finished.map((tab) => tab.id));
              }}
              title="Fechar as abas dos comandos que já terminaram"
              className="shrink-0 ml-auto px-2 py-0.5 rounded text-[11px] font-mono text-[#a1a1aa] hover:bg-[#2e2e33]"
            >
              Limpar concluídas ({finished.length})
            </button>
          )}
          {overflow.length > 0 && (
            <select
              aria-label="Mais shells"
              value=""
              onChange={(e) => e.target.value && setSelected(e.target.value)}
              className="shrink-0 bg-[#27272a] text-[#a1a1aa] text-[11px] font-mono rounded px-1 py-0.5 outline-none"
            >
              <option value="">mais ({overflow.length})</option>
              {overflow.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.agent ? `${tab.agent} › ` : ""}
                  {tab.label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <LiveShell sessionId={`${sessionId}:${current}`} text={text} />
    </div>
  );
}
