// Keeps every screen (the desktop window and paired phones) in step when one of them changes a
// conversation. The screen that acted already has the change; the others are told about it:
// - a reply started elsewhere shows up live, like a turn the CLI starts on its own;
// - messages and conversations saved elsewhere are reloaded from the database;
// - a theme or language chosen on the desktop applies on the phones too.
const MESSAGE_CHANNELS = new Set([
  "save-chat-message",
  "replace-chat-messages",
  "interrupt-cli-session",
  "cancel-queued-prompt",
  "force-queued-prompt",
  "answer-now-prompt",
  "compact-session",
]);
const INHERITED_SETTINGS = ["theme", "language"];
const SESSION_CHANNELS = new Set(["save-session", "delete-session", "set-session-archived"]);

function sessionIdOf(channel, args) {
  const [first] = args;
  if (channel === "save-chat-message" || channel === "save-session") return first?.sessionId ?? first?.id;
  if (typeof first === "string") return first;
  return first?.sessionId;
}

function createClientSync({ emitOthers, activeIds = () => [] }) {
  const messagesChanged = (origin, sessionId) =>
    sessionId &&
    emitOthers(origin, "chat-sync", {
      kind: "messages",
      sessionId,
      // Still running: the live reply on the other screen is newer than what's saved.
      active: activeIds().includes(sessionId),
    });

  function before(origin, channel, args) {
    if (channel !== "execute-cli-prompt") return;
    const p = args[0] || {};
    if (!p.sessionId || !p.responseMessageId) return;
    emitOthers(origin, "cli-turn-started", {
      sessionId: p.sessionId,
      responseMessageId: p.responseMessageId,
      providerId: p.providerId,
      model: p.model,
    });
  }

  function after(origin, channel, args, result) {
    if (channel === "execute-cli-prompt") {
      const p = args[0] || {};
      if (!p.sessionId || !p.responseMessageId) return;
      const base = { sessionId: p.sessionId, responseMessageId: p.responseMessageId, providerId: p.providerId };
      // Delivered into the reply in progress: it keeps streaming, the reload brings the rest.
      if (!result?.injected)
        emitOthers(
          origin,
          "cli-turn-finished",
          result?.cancelled && !result?.stopped
            ? { ...base, ok: false, text: "", discard: true }
            : {
                ...base,
                // Stopped: what came out so far, not an error.
                ok: !!result?.ok || !!result?.stopped,
                text: String(result?.output || ""),
                error: result?.error,
                events: result?.events,
                model: p.model,
              },
        );
      messagesChanged(origin, p.sessionId);
      return;
    }
    if (channel === "save-app-settings") {
      // The phones follow the desktop's theme and language.
      const changed = Object.keys(args[0] || {}).filter((key) => INHERITED_SETTINGS.includes(key));
      if (changed.length && result?.success && result.settings)
        emitOthers(origin, "chat-sync", {
          kind: "settings",
          settings: Object.fromEntries(INHERITED_SETTINGS.map((key) => [key, result.settings[key]])),
        });
      return;
    }
    if (MESSAGE_CHANNELS.has(channel)) return messagesChanged(origin, sessionIdOf(channel, args));
    if (SESSION_CHANNELS.has(channel))
      emitOthers(origin, "chat-sync", { kind: "sessions", sessionId: sessionIdOf(channel, args) });
  }

  // Runs a handler and tells the other screens what changed (also when it failed halfway).
  async function run(origin, channel, args, handler) {
    before(origin, channel, args);
    let result;
    try {
      result = await handler();
      return result;
    } finally {
      try {
        after(origin, channel, args, result);
      } catch {}
    }
  }

  return { run, before, after };
}

module.exports = { createClientSync };
