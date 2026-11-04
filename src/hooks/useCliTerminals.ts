import { useCallback, useEffect, useRef, useState } from "react";
import { beagleApi, terminalAvailable } from "../api/beagleApi";

/** Conversas abertas no modo terminal (a interface própria da CLI) e o estado de cada processo. */
export interface TerminalState {
  exited: boolean;
  exitCode: number | null;
}

// Colagem como o terminal faz: a CLI recebe o bloco inteiro de uma vez, sem enviar no meio.
const bracketed = (text: string) => `\x1b[200~${text.replace(/\x1b\[20[01]~/g, "")}\x1b[201~`;

/**
 * `enabled`: a configuração "Terminal da CLI" está ligada. Cada conversa aberta na tela passa a
 * usar o terminal; os terminais abertos continuam rodando ao trocar de conversa (a grade mostra).
 */
export function useCliTerminals(setAppError: (message: string) => void, enabled: boolean) {
  const [terminals, setTerminals] = useState<Record<string, TerminalState>>({});
  // A visão montada registra a colagem do xterm, que respeita o modo de colagem pedido pela CLI.
  const pasters = useRef(new Map<string, (text: string) => void>());

  // Uma recarga da janela não perde os terminais que continuam rodando no processo principal.
  useEffect(() => {
    if (!terminalAvailable()) return;
    beagleApi
      .cliTerminalList()
      .then((list) =>
        setTerminals((prev) => {
          const next = { ...prev };
          for (const t of list) next[t.sessionId] = { exited: t.exited, exitCode: t.exitCode };
          return next;
        }),
      )
      .catch(() => undefined);
    return beagleApi.on("cli-terminal-exit", ({ sessionId, exitCode }) =>
      setTerminals((prev) =>
        prev[sessionId] ? { ...prev, [sessionId]: { exited: true, exitCode } } : prev,
      ),
    );
  }, []);

  const active = enabled && terminalAvailable();
  const isTerminal = useCallback((sessionId?: string) => active && !!sessionId, [active]);

  /** Encerra a CLI do terminal da conversa (conversa apagada ou volta para o chat). */
  const closeTerminal = useCallback(
    async (sessionId: string) => {
      try {
        await beagleApi.cliTerminalClose(sessionId);
      } catch (error) {
        setAppError((error as Error).message);
      }
      pasters.current.delete(sessionId);
      setTerminals((prev) => {
        if (!prev[sessionId]) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    },
    [setAppError],
  );

  // Voltou para o chat nas configurações: encerra todas as CLIs do terminal, para o chat poder usar
  // as conversas.
  const openIds = Object.keys(terminals).join("|");
  useEffect(() => {
    if (active || !openIds) return;
    for (const id of openIds.split("|")) void closeTerminal(id);
  }, [active, openIds, closeTerminal]);

  const markStarted = useCallback((sessionId: string) => {
    setTerminals((prev) => ({ ...prev, [sessionId]: { exited: false, exitCode: null } }));
  }, []);

  const registerPaster = useCallback((sessionId: string, paste: ((text: string) => void) | null) => {
    if (paste) pasters.current.set(sessionId, paste);
    else pasters.current.delete(sessionId);
  }, []);

  /** Cola texto na CLI (ditado, handoff); `submit` aperta Enter depois, como a pessoa faria. */
  const pasteToTerminal = useCallback(
    async (sessionId: string, text: string, submit = false) => {
      const paste = pasters.current.get(sessionId);
      try {
        if (paste) paste(text);
        else await beagleApi.cliTerminalWrite({ sessionId, data: bracketed(text) });
        // A CLI precisa terminar de receber a colagem antes do Enter; junto, ele viraria parte do texto.
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
    closeTerminal,
    markStarted,
    registerPaster,
    pasteToTerminal,
  };
}
