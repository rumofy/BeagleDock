// Timeline of a reply's events (reasoning, commands, tools, MCP, files,
// plan, agents, compaction…), in the same format for Claude Code, Codex and AGY.
//
// Agents launched in the background keep working after the turn ends (and even after
// another turn starts). Their events belong to the reply that launched them: the tracker keeps them
// "loose" in that reply and notifies `onLate` (with a delay) so the screen and the history update.
const { redact } = require("./redact");
const { t } = require("./i18n");

const MAX_EVENTS = 300;
const MAX_TEXT = 4000;
const MAX_PLAN_TEXT = 60000;
const TEXT_THROTTLE_MS = 120;
const LATE_DEBOUNCE_MS = 400;

// Agents and commands launched in the background keep running after the turn ends.
const isBackgroundAgent = (event) =>
  (event.kind === "agent" || event.kind === "command") &&
  event.meta?.background === true;

function createEventTracker({
  emit = () => {},
  sessionId,
  pid = () => undefined,
  now = Date.now,
  // Updates outside the active turn: ({ sessionId, responseMessageId, events }).
  onLate = () => {},
  setTimer = (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimer = clearTimeout,
}) {
  // One group of events per reply: the current one and the "loose" ones (background agents).
  const groups = new Map();
  let currentId;
  let active = false;
  // Earlier replies of the turn in progress: a message delivered mid-turn opens a
  // new reply (see `rotate`), and what was already running stays in the reply before.
  const turnIds = new Set();
  const lastPublished = new Map();
  const lateTimers = new Map();
  // Raw reasoning text: mask only the published copy, otherwise a secret split between two
  // chunks would slip through (the first becomes ***, the rest of the key arrives later).
  const raw = new Map();

  const group = (responseId) => {
    if (!groups.has(responseId)) groups.set(responseId, new Map());
    return groups.get(responseId);
  };
  // Which reply an event is in: the current one, a loose one that already has it, or the parent's (late child).
  function locate(id, parentId) {
    if (group(currentId).has(id)) return currentId;
    for (const [responseId, events] of groups)
      if (responseId !== currentId && events.has(id)) return responseId;
    if (parentId) {
      for (const [responseId, events] of groups)
        if (responseId !== currentId && events.has(parentId)) return responseId;
    }
    return currentId;
  }
  const isLate = (responseId) =>
    !active || (responseId !== currentId && !turnIds.has(responseId));

  function scheduleLate(responseId) {
    if (lateTimers.has(responseId)) return;
    lateTimers.set(
      responseId,
      setTimer(() => flushLateFor(responseId), LATE_DEBOUNCE_MS),
    );
  }
  function flushLateFor(responseId) {
    const timer = lateTimers.get(responseId);
    if (timer === undefined) return;
    clearTimer(timer);
    lateTimers.delete(responseId);
    const events = groups.get(responseId);
    if (events)
      onLate({
        sessionId,
        responseMessageId: responseId,
        events: [...events.values()],
      });
    // A loose reply with nothing in progress: it can be forgotten.
    if (
      events &&
      responseId !== currentId &&
      ![...events.values()].some((e) => e.status === "running")
    )
      groups.delete(responseId);
  }

  const publish = (event, responseId) => {
    lastPublished.set(event.id, now());
    emit("cli-activity-event", {
      sessionId,
      responseMessageId: responseId,
      event: { ...event },
      pid: pid(),
    });
  };

  function upsert(id, patch = {}, { quiet = false } = {}) {
    if (!id) return null;
    const responseId = locate(id, patch.parentId);
    const events = group(responseId);
    let event = events.get(id);
    if (!event) {
      if (events.size >= MAX_EVENTS) return null;
      event = {
        id,
        kind: "status",
        title: "",
        status: "running",
        startedAt: now(),
      };
    }
    const next = { ...event, ...patch };
    if (patch.meta) next.meta = { ...event.meta, ...patch.meta };
    // Nothing sensitive leaves here: the same event is shown live and saved in the history.
    for (const key of ["title", "detail", "text"])
      if (typeof next[key] === "string") next[key] = redact(next[key]);
    // A proposed plan is read in full; other steps keep only the tail of their text.
    if (next.meta?.proposal && typeof next.text === "string" && next.text.length > MAX_PLAN_TEXT)
      next.text = next.text.slice(0, MAX_PLAN_TEXT - 1) + "…";
    else if (!next.meta?.proposal && typeof next.text === "string" && next.text.length > MAX_TEXT)
      next.text = "…" + next.text.slice(-MAX_TEXT + 1);
    events.set(id, next);
    if (!quiet) publish(next, responseId);
    if (isLate(responseId)) scheduleLate(responseId);
    return next;
  }

  function finishGroup(responseId, status, all) {
    const events = groups.get(responseId);
    if (!events) return;
    const background = new Set(
      all ? [] : [...events.values()].filter(isBackgroundAgent).map((e) => e.id),
    );
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of events.values())
        if (
          e.parentId &&
          background.has(e.parentId) &&
          !background.has(e.id)
        ) {
          background.add(e.id);
          grew = true;
        }
    }
    for (const event of [...events.values()])
      if (event.status === "running" && !background.has(event.id))
        api.finish(event.id, status);
  }

  const api = {
    // Starts reply `id`. Background agents still running (and what's theirs) stay loose
    // in the original reply, instead of disappearing.
    start(id) {
      for (const previous of [...turnIds, currentId]) {
        if (previous === undefined) continue;
        const events = groups.get(previous);
        if (events) {
          const keep = new Set(
            [...events.values()]
              .filter((e) => isBackgroundAgent(e) && e.status === "running")
              .map((e) => e.id),
          );
          let grew = true;
          while (grew) {
            grew = false;
            for (const e of events.values())
              if (e.parentId && keep.has(e.parentId) && !keep.has(e.id)) {
                keep.add(e.id);
                grew = true;
              }
          }
          if (keep.size) {
            for (const eventId of [...events.keys()])
              if (!keep.has(eventId)) events.delete(eventId);
          } else groups.delete(previous);
        }
      }
      turnIds.clear();
      currentId = id;
      groups.set(id, new Map());
      active = true;
      lastPublished.clear();
      // The raw text of loose events is kept; the rest is discarded.
      for (const key of [...raw.keys()]) if (!api.get(key)) raw.delete(key);
    },
    // Message delivered mid-turn: new steps go to reply `id`; the ones that already
    // existed (a command still running, for example) continue and finish in the reply before.
    rotate(id) {
      if (!id || id === currentId) return;
      if (currentId !== undefined) turnIds.add(currentId);
      currentId = id;
      groups.set(id, new Map());
    },
    // The turn ended; whatever still changes from here is a late update.
    endTurn() {
      active = false;
    },
    upsert,
    appendText(id, delta, patch = {}) {
      if (!delta) return;
      const current = api.get(id);
      const text = (raw.get(id) || "") + delta;
      raw.set(
        id,
        text.length > MAX_TEXT * 2 ? text.slice(-MAX_TEXT * 2) : text,
      );
      const next = upsert(id, { ...patch, text: raw.get(id) }, { quiet: true });
      // The first chunk goes out right away; the next ones, at most every 120 ms.
      if (
        next &&
        (!current?.text ||
          now() - (lastPublished.get(id) || 0) >= TEXT_THROTTLE_MS)
      )
        publish(next, locate(id, patch.parentId));
    },
    // Replaces the whole text (e.g. reasoning assembled from parts), with the same rule.
    setText(id, text, patch = {}) {
      const current = api.get(id);
      raw.set(id, String(text ?? ""));
      const next = upsert(id, { ...patch, text }, { quiet: true });
      if (
        next &&
        (!current?.text ||
          now() - (lastPublished.get(id) || 0) >= TEXT_THROTTLE_MS)
      )
        publish(next, locate(id, patch.parentId));
    },
    finish(id, status = "done", patch = {}) {
      const current = api.get(id);
      if (!current || current.status !== "running") return;
      const endedAt = now();
      upsert(id, {
        ...patch,
        status,
        endedAt,
        durationMs: patch.durationMs ?? endedAt - current.startedAt,
      });
    },
    // Closes what's still running in the turn, EXCEPT background agents (and their steps): those
    // keep working and finish on their own, through the CLI's own final event.
    // With `all`, it also closes the background ones (the CLI ended: nothing else will report their end).
    finishRunning(status = "done", { all = false } = {}) {
      for (const responseId of [...turnIds, currentId]) finishGroup(responseId, status, all);
    },
    // The CLI exited: nothing else will report the end of what was still listed as running.
    finishAll(status = "error", note = t("activity.cliExitedEarly")) {
      for (const events of [...groups.values()])
        for (const event of [...events.values()])
          if (event.status === "running")
            api.finish(event.id, status, {
              meta: { note: event.meta?.note ? `${event.meta.note} · ${note}` : note },
            });
    },
    get(id) {
      for (const events of groups.values())
        if (events.has(id)) return events.get(id);
      return undefined;
    },
    // Events of the current reply (what the turn returns when it ends).
    snapshot: () => [...group(currentId).values()],
    // Events of one reply of the turn (the original or that of a message delivered midway).
    snapshotFor: (id) => [...(groups.get(id)?.values() || [])],
    // Searches all replies (a message delivered mid-turn opens another reply).
    find(predicate) {
      for (const events of groups.values())
        for (const event of events.values()) if (predicate(event)) return event;
      return undefined;
    },
    filter(predicate) {
      const found = [];
      for (const events of groups.values())
        for (const event of events.values()) if (predicate(event)) found.push(event);
      return found;
    },
    // Delivers pending late updates right away (app shutdown, tests).
    flushLate() {
      for (const responseId of [...lateTimers.keys()]) flushLateFor(responseId);
    },
  };
  return api;
}

module.exports = { createEventTracker, MAX_EVENTS, MAX_TEXT };
