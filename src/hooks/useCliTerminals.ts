import { useCallback, useEffect, useRef, useState } from "react";
import { beagleApi, terminalAvailable } from "../api/beagleApi";

/** Conversations open in terminal mode (the CLI's own interface) and the state of each process. */
export interface TerminalState {
  exited: boolean;
  exitCode: number | null;
  status: "running" | "idle" | "waiting_input";
}

// Paste the way a terminal does: the CLI gets the whole block at once, without submitting midway.
const bracketed = (text: string) => `\x1b[200~${text.replace(/\x1b\[20[01]~/g, "")}\x1b[201~`;

/**
 * `enabled`: the "CLI terminal" setting is on. Every conversation opened on screen uses the
 * terminal; open terminals keep running when switching conversations (the grid shows them).
 */
export function useCliTerminals(setAppError: (message: string) => void, enabled: boolean) {
  const [terminals, setTerminals] = useState<Record<string, TerminalState>>({});
  const [requested, setRequested] = useState<string[]>([]);
  const hasStarted = useCallback((sessionId?: string) => !!sessionId && !!terminals[sessionId], [terminals]);
  const isOpening = useCallback((sessionId?: string) => !!sessionId && requested.includes(sessionId), [requested]);
  const startTerminal = (sessionId: string) => setRequested((prev) => prev.includes(sessionId) ? prev : [...prev, sessionId]);
  // The mounted view registers xterm's paste, which honors the paste mode the CLI asked for.
  const pasters = useRef(new Map<string, (text: string) => void>());

  // Reloading the window doesn't lose the terminals still running in the main process.
  useEffect(() => {
    if (!terminalAvailable()) return;
    beagleApi
      .cliTerminalList()
      .then((list) =>
        setTerminals((prev) => {
          const next = { ...prev };
          for (const t of list) next[t.sessionId] = { exited: t.exited, exitCode: t.exitCode, status: t.status || "idle" };
          return next;
        }),
      )
      .catch(() => undefined);
    const unsubscribeOpened = beagleApi.on("cli-terminal-opened", ({ sessionId }) => {
      setTerminals((prev) => ({ ...prev, [sessionId]: { exited: false, exitCode: null, status: "idle" } }));
    });
    const unsubscribeState = beagleApi.on("cli-terminal-state", ({ sessionId, status }) => {
      setTerminals((prev) => ({
        ...prev,
        [sessionId]: { ...(prev[sessionId] || { exited: false, exitCode: null }), status },
      }));
    });
    const unsubscribeExit = beagleApi.on("cli-terminal-exit", ({ sessionId, exitCode }) =>
      setTerminals((prev) =>
        prev[sessionId] ? { ...prev, [sessionId]: { exited: true, exitCode, status: "idle" } } : prev,
      ),
    );
    return () => { unsubscribeOpened(); unsubscribeState(); unsubscribeExit(); };
  }, []);

  const active = enabled && terminalAvailable();
  const isTerminal = useCallback((sessionId?: string) => active && !!sessionId, [active]);

  /** Stops the conversation's terminal CLI (conversation deleted or back to the chat). */
  const closeTerminal = useCallback(
    async (sessionId: string) => {
      try {
        await beagleApi.cliTerminalClose(sessionId);
      } catch (error) {
        setAppError((error as Error).message);
      }
      pasters.current.delete(sessionId);
      setRequested((prev) => prev.filter((id) => id !== sessionId));
      setTerminals((prev) => {
        if (!prev[sessionId]) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    },
    [setAppError],
  );

  // Switched back to the chat in settings: stop every terminal CLI so the chat can use the
  // conversations.
  const openIds = Object.keys(terminals).join("|");
  useEffect(() => {
    if (active || !openIds) return;
    for (const id of openIds.split("|")) void closeTerminal(id);
  }, [active, openIds, closeTerminal]);

  const markStarted = useCallback((sessionId: string) => {
    setTerminals((prev) => ({ ...prev, [sessionId]: { exited: false, exitCode: null, status: prev[sessionId]?.status || "idle" } }));
    setRequested((prev) => prev.filter((id) => id !== sessionId));
  }, []);

  const markStartFailed = useCallback((sessionId: string, cwdLocked: boolean, message: string) => {
    setRequested((prev) => prev.filter((id) => id !== sessionId));
    if (cwdLocked) {
      setTerminals((prev) => ({ ...prev, [sessionId]: { exited: true, exitCode: null, status: "idle" } }));
    } else {
      setTerminals((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    }
    setAppError(message);
  }, [setAppError]);

  const registerPaster = useCallback((sessionId: string, paste: ((text: string) => void) | null) => {
    if (paste) pasters.current.set(sessionId, paste);
    else pasters.current.delete(sessionId);
  }, []);

  /** Pastes text into the CLI (dictation, handoff); `submit` presses Enter afterwards, as a person would. */
  const pasteToTerminal = useCallback(
    async (sessionId: string, text: string, submit = false) => {
      const paste = pasters.current.get(sessionId);
      try {
        if (paste) paste(text);
        else await beagleApi.cliTerminalWrite({ sessionId, data: bracketed(text) });
        // The CLI must finish receiving the paste before Enter; sent together, it would become part of the text.
        if (submit) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          await beagleApi.cliTerminalWrite({ sessionId, data: "\r" });
        }
      } catch (error) {
        setAppError((error as Error).message);
      }
    },
    [setAppError],
  );

  return {
    terminals,
    isTerminal,
    hasStarted,
    isOpening,
    startTerminal,
    closeTerminal,
    markStarted,
    markStartFailed,
    registerPaster,
    pasteToTerminal,
  };
}
