import { useState } from "react";
import { Maximize2, Minimize2, MessageSquare } from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import { CompanyIcon } from "../../components/CompanyIcon";
import { SessionShell } from "./SessionShell";
import { CliTerminalView } from "./CliTerminalView";

import { t } from "../../i18n";
/** Grid with the CLIs open in terminal mode, to follow several at once. */
function TerminalGrid() {
  const { cliTerminals, allSessions, setActiveSessionId, setActiveTab } = useApp();
  const [focused, setFocused] = useState<string | null>(null);
  const open = allSessions.filter((s) => cliTerminals.terminals[s.id]);
  const shown = focused && open.some((s) => s.id === focused) ? open.filter((s) => s.id === focused) : open;
  const columns = shown.length <= 1 ? 1 : shown.length <= 4 ? 2 : 3;
  return (
    <div
      data-testid="terminal-grid"
      className="flex-1 min-h-0 p-3 grid gap-3"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridAutoRows: "minmax(0, 1fr)",
      }}
    >
      {shown.map((session) => (
        <div
          key={session.id}
          className="min-h-0 flex flex-col rounded-xl overflow-hidden border border-[#27272a] bg-[#141416] shadow-lg"
        >
          <div className="h-9 shrink-0 bg-[#1e1e21] px-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <CompanyIcon id={session.providerId} size={16} className="shrink-0" />
              <span className="text-xs font-semibold text-[#e4e4e7] truncate" title={session.title}>
                {session.title}
              </span>
              <span className="text-[10px] font-mono text-[#71717a] truncate" title={session.cwd}>
                {session.cwd.split(/[\\/]/).filter(Boolean).pop()}
              </span>
              {cliTerminals.terminals[session.id]?.exited && (
                <span className="text-[10px] font-bold text-amber-300">{t("terminalTab.exited")}</span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setActiveSessionId(session.id);
                  setActiveTab("chat");
                }}
                className="p-1 rounded text-[#a1a1aa] hover:bg-[#2e2e33]"
                title={t("terminalTab.openConversation")}
              >
                <MessageSquare size={13} />
              </button>
              {open.length > 1 && (
                <button
                  type="button"
                  onClick={() => setFocused((id) => (id === session.id ? null : session.id))}
                  className="p-1 rounded text-[#a1a1aa] hover:bg-[#2e2e33]"
                  title={focused === session.id ? t("terminalTab.backToGrid") : t("terminalTab.enlarge")}
                >
                  {focused === session.id ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </button>
              )}
            </div>
          </div>
          <CliTerminalView session={session} compact={shown.length > 1} />
        </div>
      ))}
    </div>
  );
}

export function TerminalTab() {
  const { currentSession, currentProvider, cliTerminals } = useApp();
  if (Object.keys(cliTerminals.terminals).length) return <TerminalGrid />;
  return (
            <div className="p-6 flex-1 flex flex-col overflow-hidden">
              <p className="max-w-5xl w-full mx-auto mb-3 text-xs text-[#7e7565]">
                {t("terminalTab.empty")}
              </p>
              <div className="max-w-5xl w-full mx-auto flex-1 flex flex-col bg-[#141416] rounded-2xl overflow-hidden shadow-xl border border-[#27272a]">
                <div className="h-10 bg-[#1e1e21] px-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                    <span className="ml-2 font-mono text-xs text-[#a1a1aa] font-medium">
                      {currentProvider?.cliPath} — Workspace:{" "}
                      {currentSession?.cwd}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono text-[#a1a1aa]">
                    <span className="px-2 py-0.5 rounded bg-[#27272a] text-[#e4e4e7]">
                      PID {currentSession?.pid || "ativo"}
                    </span>
                  </div>
                </div>

                <SessionShell sessionId={currentSession?.id || ""} />
              </div>
            </div>
  );
}
