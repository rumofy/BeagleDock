import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { beagleApi } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import type { ChatSession } from "../../types";
import { DICTATION_TOGGLE_EVENT } from "./TerminalDictationButton";

// Caminho arrastado para o terminal: entre aspas simples quando tem espaço ou símbolo do shell.
export const quotePath = (p: string) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);

/**
 * A interface própria da CLI da conversa. Teclas, colagem e arquivos arrastados vão direto
 * para ela: anexar imagem, plano, aprovações e histórico ficam por conta da CLI.
 */
export function CliTerminalView({ session, compact = false }: { session: ChatSession; compact?: boolean }) {
  const { cliTerminals, setAppError } = useApp();
  const { terminals, markStarted, registerPaster } = cliTerminals;
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [error, setError] = useState("");
  // Muda para forçar a reabertura depois que a CLI encerrou.
  const [attempt, setAttempt] = useState(0);
  const state = terminals[session.id];

  useEffect(() => {
    if (!host.current) return;
    const id = session.id;
    const term = new Terminal({
      fontSize: compact ? 12 : 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
      scrollback: 10000,
      cursorBlink: true,
      allowProposedApi: false,
      theme: { background: "#18181b", foreground: "#e4e4e7" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    termRef.current = term;
    try {
      fit.fit();
    } catch {}
    let end = -1;
    const early: Array<{ data: string; end: number }> = [];
    let disposed = false;
    const unsubscribe = beagleApi.on("cli-terminal-data", (payload) => {
      if (payload.sessionId !== id) return;
      if (end < 0) early.push(payload);
      else if (payload.end > end) {
        term.write(payload.data);
        end = payload.end;
      }
    });
    const write = (data: string) => void beagleApi.cliTerminalWrite({ sessionId: id, data });
    term.onData(write);
    term.onBinary(write);
    term.onResize(({ cols, rows }) => void beagleApi.cliTerminalResize({ sessionId: id, cols, rows }));
    // Ctrl+V: com imagem, a CLI lê a área de transferência sozinha (é assim que ela anexa); com
    // texto, cola. Ctrl+Shift+C/V e Ctrl+C com seleção copiam/colam como num terminal comum.
    term.attachCustomKeyEventHandler((event) => {
      // Os atalhos globais do BeagleDock (Ctrl+K, Ctrl+H, Alt+P…) não roubam teclas da CLI.
      event.stopPropagation();
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "m") {
        event.preventDefault();
        window.dispatchEvent(new Event(DICTATION_TOGGLE_EVENT));
        return false;
      }
      if (event.ctrlKey && !event.altKey && key === "v") {
        event.preventDefault();
        void beagleApi
          .cliTerminalClipboard()
          .then(({ image, text }) => {
            if (image && !event.shiftKey) write("\x16");
            else if (text) term.paste(text);
          })
          .catch((e: Error) => setAppError(`Não foi possível ler a área de transferência: ${e.message}`));
        return false;
      }
      if (event.ctrlKey && !event.altKey && key === "c" && (event.shiftKey || term.hasSelection())) {
        const selected = term.getSelection();
        if (selected) void navigator.clipboard.writeText(selected).catch(() => undefined);
        term.clearSelection();
        return false;
      }
      return true;
    });
    registerPaster(id, (text) => {
      term.paste(text);
      term.focus();
    });
    beagleApi
      .cliTerminalOpen({
        sessionId: id,
        providerId: session.providerId,
        cwd: session.cwd,
        cols: term.cols,
        rows: term.rows,
      })
      .then((result) => {
        if (disposed) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setError("");
        markStarted(id);
        if (result.replay) term.write(result.replay);
        end = result.end;
        for (const item of early.splice(0)) if (item.end > end) {
          term.write(item.data);
          end = item.end;
        }
        // A CLI redesenha a tela no tamanho desta visão (outra visão pode ter mudado o tamanho).
        void beagleApi.cliTerminalResize({ sessionId: id, cols: term.cols, rows: term.rows });
        term.focus();
      })
      .catch((e: Error) => !disposed && setError(e.message));
    const resize = new ResizeObserver(() => {
      if (host.current?.clientWidth && host.current.clientHeight)
        try {
          fit.fit();
        } catch {}
    });
    resize.observe(host.current);
    return () => {
      disposed = true;
      resize.disconnect();
      unsubscribe();
      registerPaster(id, null);
      termRef.current = null;
      // O xterm agenda um ajuste da rolagem logo depois de abrir; descartado antes disso, ele lê o
      // renderizador já destruído ("reading 'dimensions'"). Trocar de conversa rápido causava isso.
      window.setTimeout(() => term.dispose(), 100);
    };
  }, [session.id, session.providerId, session.cwd, compact, attempt, markStarted, registerPaster]);

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => beagleApi.pathForFile?.(file) || "")
      .filter(Boolean);
    if (!paths.length) return;
    termRef.current?.paste(paths.map(quotePath).join(" ") + " ");
    termRef.current?.focus();
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-[#18181b]" data-testid="cli-terminal">
      <div
        ref={host}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="flex-1 min-h-0 overflow-hidden p-2"
      />
      {(error || state?.exited) && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#18181b]/85">
          <div className="max-w-md rounded-xl border border-[#3f3f46] bg-[#232326] p-4 text-sm text-[#e4e4e7] space-y-3">
            <p>
              {error ||
                `A CLI encerrou${state?.exitCode !== null && state?.exitCode !== undefined ? ` (código ${state.exitCode})` : ""}.`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setError("");
                  void beagleApi
                    .cliTerminalClose(session.id)
                    .catch((e: Error) => setAppError(e.message))
                    .finally(() => setAttempt((n) => n + 1));
                }}
                className="px-3 py-1.5 rounded-lg bg-white text-[#1c1b18] text-xs font-bold"
              >
                Reabrir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
