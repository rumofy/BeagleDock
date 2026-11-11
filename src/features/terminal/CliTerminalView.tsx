import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { beagleApi } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import type { ChatSession } from "../../types";
import { DICTATION_CANCEL_EVENT, DICTATION_TOGGLE_EVENT, dictationRecording } from "./TerminalDictationButton";

import { t } from "../../i18n";
// Path dragged into the terminal: single-quoted when it has a space or a shell symbol.
export const quotePath = (p: string) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);

/**
 * The conversation's own CLI interface. Keys, pastes and dragged files go straight to it:
 * attaching images, plan mode and approvals are up to the CLI (the history is read from the native
 * conversation file, see electron/terminal-history.js).
 */
export function CliTerminalView({ session, compact = false }: { session: ChatSession; compact?: boolean }) {
  const { cliTerminals, setAppError, setProviders } = useApp();
  const { terminals, markStarted, markStartFailed, registerPaster } = cliTerminals;
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [error, setError] = useState("");
  // Changes to force reopening after the CLI exited.
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
    let attachedPid: number | null = null;
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
    const write = (data: string) => void beagleApi.cliTerminalWrite({ sessionId: id, data }).catch((e: Error) => setAppError(e.message));
    term.onData(write);
    term.onBinary(write);
    term.onResize(({ cols, rows }) => void beagleApi.cliTerminalResize({ sessionId: id, cols, rows }));
    const unsubscribeOpened = beagleApi.on("cli-terminal-opened", ({ sessionId, pid }) => {
      if (sessionId === id && attachedPid !== null && attachedPid !== pid) setAttempt((n) => n + 1);
    });
    const unsubscribeClosed = beagleApi.on("cli-terminal-closed", ({ sessionId }) => {
      if (sessionId === id) setError(t("terminal.exited"));
    });
    // Ctrl+V: with an image, the CLI reads the clipboard itself (that's how it attaches); with text,
    // it pastes. Ctrl+Shift+C/V and Ctrl+C with a selection copy/paste like a regular terminal.
    term.attachCustomKeyEventHandler((event) => {
      const key = event.key.toLowerCase();
      // Ctrl+H (history) works with the focus in the CLI too: it reaches the app's global shortcut
      // instead of being sent to the CLI as a backspace.
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && key === "h") return false;
      // BeagleDock's other global shortcuts (Ctrl+K, Alt+P…) don't steal keys from the CLI.
      event.stopPropagation();
      if (event.type !== "keydown") return true;
      // Esc while dictating discards the recording; it doesn't reach the CLI (where it would interrupt).
      if (key === "escape" && dictationRecording()) {
        event.preventDefault();
        window.dispatchEvent(new Event(DICTATION_CANCEL_EVENT));
        return false;
      }
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
          .catch((e: Error) => setAppError(t("terminal.clipboardFailed", { error: e.message })));
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
        if (result.ok || result.cwdLocked) {
          setProviders((prev) => prev.map((provider) => ({ ...provider,
            sessions: provider.sessions.map((saved) => saved.id === id ? { ...saved, cwdLocked: true } : saved),
          })));
        }
        if (!result.ok) {
          setError(result.error);
          if (typeof result.cwdLocked === "boolean") markStartFailed(id, result.cwdLocked, result.error);
          return;
        }
        setError("");
        setAppError("");
        attachedPid = result.pid;
        markStarted(id);
        if (result.replay) term.write(result.replay);
        end = result.end;
        for (const item of early.splice(0)) if (item.end > end) {
          term.write(item.data);
          end = item.end;
        }
        // The CLI redraws the screen at this view's size (another view may have changed it).
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
      unsubscribeOpened();
      unsubscribeClosed();
      registerPaster(id, null);
      termRef.current = null;
      // xterm schedules a scroll adjustment right after opening; disposed before that, it reads the
      // already destroyed renderer ("reading 'dimensions'"). Switching conversations quickly caused it.
      window.setTimeout(() => term.dispose(), 100);
    };
  }, [session.id, session.providerId, session.cwd, compact, attempt, markStarted, markStartFailed, registerPaster, setProviders, setAppError]);

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
                (state?.exitCode !== null && state?.exitCode !== undefined ? t("terminal.exitedCode", { code: state.exitCode }) : t("terminal.exited"))}
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
                {t("terminal.reopen")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
