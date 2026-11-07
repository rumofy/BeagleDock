// `window.beagleAPI` on the phone: the desktop app's own interface runs here and reaches the
// computer's backend over the paired HTTPS connection. Methods the phone isn't allowed to call
// (shell, settings, folders, memory maintenance) don't exist, so the interface hides them.
import { call, subscribe, type RemoteEvent } from "./mobileClient";

/** Same list as electron/remote-api.js (checked by the tests). */
export const REMOTE_METHODS = [
  "cliTerminalOpen",
  "cliTerminalWrite",
  "cliTerminalResize",
  "cliTerminalClose",
  "cliTerminalList",
  "detectTools",
  "getAppVersion",
  "getUserProfile",
  "getSavedState",
  "getSessions",
  "getGlobalPermissions",
  "getCliApprovals",
  "resolveCliApproval",
  "setLivePermission",
  "checkCliUpdates",
  "readNotifications",
  "getAIMemoryStatus",
  "getAIMemoryScope",
  "getInstalledSkills",
  "getCliHistory",
  "loadFullConversation",
  "deleteConversation",
  "saveSession",
  "deleteSession",
  "compactSession",
  "setSessionArchived",
  "searchProjectFiles",
  "listWorkspaceStatus",
  "listNativeCommands",
  "saveAppSettings",
  "transcribeAudio",
  "getDictationStatus",
  "replaceChatMessages",
  "saveChatMessage",
  "getChatMessages",
  "getLiveTurns",
  "awaitTurnResult",
  "interruptCliSession",
  "cancelQueuedPrompt",
  "forceQueuedPrompt",
  "answerNowPrompt",
  "executeCliPrompt",
] as const;

export type ConnectionState = "connecting" | "connected" | "offline" | "unpaired";

// fetch rejects with a TypeError when the connection itself fails ("Load failed" on iOS); answers
// from the computer (HTTP errors) come as plain errors.
const isNetworkError = (error: unknown) => (error as Error | null)?.name === "TypeError";
const RECOVER_RETRY_MAX_MS = 5000;

/**
 * Outcome of a prompt whose request was lost: asks the computer (waiting while the reply runs),
 * again and again while offline. Fails with the original error if the computer never got it.
 */
export async function recoverTurn(
  responseMessageId: string,
  original: unknown,
  ask: (id: string) => Promise<unknown> = (id) => call("awaitTurnResult", [id]),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let delay = 1000;
  for (;;) {
    // Also before the first ask: a request cut right after it reached the computer may not have
    // started the turn there yet, and an early ask would wrongly hear "never got it".
    await wait(delay);
    delay = Math.min(delay * 2, RECOVER_RETRY_MAX_MS);
    let result: unknown;
    try {
      result = await ask(responseMessageId);
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      result = undefined;
    }
    if (result === null) throw original;
    if (result !== undefined) return result;
  }
}

export function createRemoteBridge(onState: (state: ConnectionState) => void) {
  const subscribers = new Map<string, Set<(payload: unknown) => void>>();
  const dispatch = (channel: string, payload: unknown) =>
    subscribers.get(channel)?.forEach((fn) => {
      try {
        fn(payload);
      } catch {}
    });
  // Conversations whose messages are on screen (reloaded after a reconnection).
  const openSessions = new Set<string>();
  let connectedOnce = false;
  const stop = subscribe(
    ({ channel, payload }: RemoteEvent) => dispatch(channel, payload),
    (state) => {
      onState(state);
      if (state !== "connected") return;
      // Back after a drop (screen off, Wi-Fi change): catch up on what happened meanwhile.
      if (connectedOnce) {
        dispatch("remote-reconnected", {});
        void call<{ settings?: Record<string, unknown> }>("getSavedState").then((saved) => {
          if (saved.settings) dispatch("chat-sync", { kind: "settings", settings: saved.settings });
        }).catch(() => {});
        dispatch("chat-sync", { kind: "sessions" });
        void call<unknown>("getCliApprovals").then((list) => dispatch("cli-approvals", list)).catch(() => {});
        void call<unknown>("detectTools").then((update) => dispatch("tools-update", update)).catch(() => {});
        for (const sessionId of openSessions) dispatch("chat-sync", { kind: "messages", sessionId, active: true });
        // Replies that started or ended while the phone was away (the dots in the list follow them).
        void call<unknown>("getLiveTurns").then((turns) => dispatch("live-turns", turns)).catch(() => {});
      }
      connectedOnce = true;
    },
  );
  const writes = new Map<string, Promise<unknown>>();
  const api: Record<string, unknown> = {};
  for (const method of REMOTE_METHODS)
    api[method] = (...args: unknown[]) => {
      if (method === "getChatMessages" && typeof args[0] === "string") openSessions.add(args[0]);
      return call(method, args);
    };
  Object.assign(api, {
    remote: true,
    // Keep keystrokes ordered even when HTTPS requests take different amounts of time.
    cliTerminalWrite: (request: { sessionId: string; data: string }) => {
      const pending = (writes.get(request.sessionId) || Promise.resolve())
        .then(() => call("cliTerminalWrite", [request]));
      const settled = pending.catch(() => undefined);
      writes.set(request.sessionId, settled);
      void settled.then(() => {
        if (writes.get(request.sessionId) === settled) writes.delete(request.sessionId);
      });
      return pending;
    },
    // The request lasts the whole reply: leaving the app (iOS cuts it) or a Wi-Fi drop doesn't stop
    // the reply on the computer, so the phone waits for its outcome there instead of failing.
    executeCliPrompt: async (payload: { responseMessageId?: string }) => {
      try {
        return await call("executeCliPrompt", [payload]);
      } catch (error) {
        if (!isNetworkError(error) || !payload?.responseMessageId) throw error;
        return recoverTurn(payload.responseMessageId, error);
      }
    },
    // On the phone, links open in the phone's own browser.
    openExternalUrl: async (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
      return { ok: true };
    },
    pickDirectory: async () => ({ canceled: true }),
    getZoom: async () => 1,
    setZoom: async () => 1,
    on: (channel: string, callback: (payload: unknown) => void) => {
      if (!subscribers.has(channel)) subscribers.set(channel, new Set());
      subscribers.get(channel)!.add(callback);
      return () => subscribers.get(channel)?.delete(callback);
    },
  });
  return { api, stop };
}
