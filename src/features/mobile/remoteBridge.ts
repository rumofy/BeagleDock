// `window.beagleAPI` on the phone: the desktop app's own interface runs here and reaches the
// computer's backend over the paired HTTPS connection. Methods the phone isn't allowed to call
// (terminal, settings, folders, memory maintenance) don't exist, so the interface hides them.
import { call, subscribe, type RemoteEvent } from "./mobileClient";

/** Same list as electron/remote-api.js (checked by the tests). */
export const REMOTE_METHODS = [
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
  "interruptCliSession",
  "cancelQueuedPrompt",
  "forceQueuedPrompt",
  "answerNowPrompt",
  "executeCliPrompt",
] as const;

export type ConnectionState = "connecting" | "connected" | "offline" | "unpaired";

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
        dispatch("chat-sync", { kind: "sessions" });
        void call<unknown>("getCliApprovals").then((list) => dispatch("cli-approvals", list)).catch(() => {});
        void call<unknown>("detectTools").then((update) => dispatch("tools-update", update)).catch(() => {});
        for (const sessionId of openSessions) dispatch("chat-sync", { kind: "messages", sessionId, active: true });
      }
      connectedOnce = true;
    },
  );
  const api: Record<string, unknown> = {};
  for (const method of REMOTE_METHODS)
    api[method] = (...args: unknown[]) => {
      if (method === "getChatMessages" && typeof args[0] === "string") openSessions.add(args[0]);
      return call(method, args);
    };
  Object.assign(api, {
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
