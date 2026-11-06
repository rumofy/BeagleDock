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

// Replies in progress on the computer, so a screen that opens (or reconnects) late still sees which
// conversations are running: a phone misses the live events while its screen is off.
function createLiveTurns() {
  const turns = new Map();
  const start = (p) => {
    if (!p?.sessionId || !p.responseMessageId) return;
    turns.set(p.responseMessageId, {
      sessionId: p.sessionId,
      responseMessageId: p.responseMessageId,
      providerId: p.providerId,
      model: p.model,
    });
  };
  const finish = (responseMessageId) => {
    turns.delete(responseMessageId);
    progress.delete(responseMessageId);
  };
  // What each reply has shown so far (latest text and activity, every step): a screen that missed
  // the live events (phone in the background, connection dropped) catches up from it.
  const progress = new Map();
  const track = (channel, payload) => {
    const id = payload?.responseMessageId;
    if (!id || !turns.has(id)) return;
    const state = progress.get(id) || { events: new Map() };
    progress.set(id, state);
    if (channel === "cli-activity-event") {
      if (payload.event?.id) state.events.set(payload.event.id, payload.event);
      return;
    }
    if (typeof payload.fullText === "string") state.text = payload.fullText;
    if (payload.activity !== undefined) {
      state.activity = payload.activity;
      state.detail = payload.detail;
    }
  };
  return {
    start,
    finish,
    // Turns the CLI starts on its own reach the screens only as events.
    observe(channel, payload) {
      if (channel === "cli-turn-started") start(payload);
      else if (channel === "cli-turn-finished" && payload?.responseMessageId) finish(payload.responseMessageId);
      else if (channel === "cli-stream-chunk" || channel === "cli-activity-event") track(channel, payload);
    },
    list: () =>
      [...turns.values()].map((turn) => {
        const state = progress.get(turn.responseMessageId);
        if (!state) return turn;
        const snapshot = { ...turn, events: [...state.events.values()] };
        if (state.text !== undefined) snapshot.text = state.text;
        if (state.activity !== undefined) {
          snapshot.activity = state.activity;
          snapshot.detail = state.detail;
        }
        return snapshot;
      }),
  };
}

// Outcome of each prompt a phone sent, kept for a while: a phone that leaves the app (iOS cuts its
// requests) loses the answer to its own request, so it asks for it again once it is back. The
// desktop window's requests don't get cut, so its turns aren't kept.
const RESULT_LIMIT = 20;
function createTurnResults() {
  const results = new Map(); // responseMessageId -> result of execute-cli-prompt
  const waiting = new Map(); // responseMessageId -> resolvers, while the turn runs
  return {
    started(id) {
      if (!waiting.has(id)) waiting.set(id, []);
    },
    finished(id, result) {
      if (!waiting.has(id)) return;
      results.delete(id);
      results.set(id, result);
      while (results.size > RESULT_LIMIT) results.delete(results.keys().next().value);
      for (const resolve of waiting.get(id) || []) resolve(result);
      waiting.delete(id);
    },
    // The turn's result; waits while it runs. null when this computer never got the prompt.
    wait(id) {
      if (results.has(id)) return Promise.resolve(results.get(id));
      const list = waiting.get(id);
      if (!list) return Promise.resolve(null);
      return new Promise((resolve) => list.push(resolve));
    },
  };
}

function createClientSync({ emitOthers, activeIds = () => [], liveTurns = createLiveTurns() }) {
  const turnResults = createTurnResults();
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
    liveTurns.start(p);
    if (origin !== "desktop") turnResults.started(p.responseMessageId);
    emitOthers(origin, "cli-turn-started", {
      sessionId: p.sessionId,
      responseMessageId: p.responseMessageId,
      providerId: p.providerId,
      model: p.model,
    });
  }

  function after(origin, channel, args, result, failure) {
    if (channel === "execute-cli-prompt") {
      const p = args[0] || {};
      if (!p.sessionId || !p.responseMessageId) return;
      // Over, also when it was delivered into the reply in progress (that one stays live).
      liveTurns.finish(p.responseMessageId);
      // Failed halfway (no result): the phone that lost its request still learns it ended, and why.
      turnResults.finished(
        p.responseMessageId,
        result ?? { ok: false, output: "", error: failure ? String(failure.message || failure) : undefined },
      );
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
    let failure;
    try {
      result = await handler();
      return result;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      try {
        after(origin, channel, args, result, failure);
      } catch {}
    }
  }

  return { run, before, after, liveTurns: liveTurns.list, awaitTurn: turnResults.wait };
}

module.exports = { createClientSync, createLiveTurns };
