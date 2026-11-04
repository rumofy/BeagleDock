const { t } = require("./i18n");
// Coordinate session mutations with turn completion. Deletion wins over late replies.
// Timestamp in the database format (UTC, with milliseconds): sorts among the whole-second ones.
const dbTime = (ms) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");
const PROVIDER_NAMES = {
  claude: "Claude Code",
  codex: "Codex CLI",
  antigravity: "Antigravity",
};

function createSessionService({ store, runner }) {
  const writes = new Map(),
    turns = new Map(),
    removing = new Map(),
    generations = new Map(),
    stopping = new Map(),
    // How many runs (running + queued) each conversation has; the message only joins the current turn
    // when it's the only one ahead of it.
    pendingCount = new Map(),
    // Queued replies the person took out of the queue and the ones the CLI already started processing.
    discarded = new Set(),
    started = new Set(),
    // Replies waiting in each conversation's queue (in order), the ones deciding between injecting
    // and queueing, the chain of those decisions and the user messages already taken off the queue.
    queuedOrder = new Map(),
    reserved = new Set(),
    decisions = new Map(),
    droppedUsers = new Set();
  const cancelled = () => ({
    ok: false,
    cancelled: true,
    error: t("session.removed"),
  });
  function write(id, operation) {
    if (removing.has(id))
      return Promise.reject(new Error(t("session.removing")));
    const pending = (writes.get(id) || Promise.resolve())
      .catch(() => {})
      .then(operation);
    writes.set(id, pending);
    pending
      .finally(() => {
        if (writes.get(id) === pending) writes.delete(id);
      })
      .catch(() => {});
    return pending;
  }
  // Replies to messages delivered mid-turn: each one is saved right before the next
  // message (the last one, at the end), so the reopened history keeps the order seen on screen.
  async function saveFollowUps(payload, result, tail = "") {
    const id = payload.sessionId;
    const list = result.followUps || [];
    const out = [];
    for (let index = 0; index < list.length; index++) {
      const item = list[index];
      const last = index === list.length - 1;
      const text = item.text || (last ? tail : "");
      const events = Array.isArray(item.events) && item.events.length ? item.events : undefined;
      out.push({ responseMessageId: item.responseMessageId, text, ...(events ? { events } : {}) });
      if ((!text && !events) || removing.has(id)) continue;
      const next = list[index + 1];
      await write(id, () =>
        store.saveChatMessage({
          id: item.responseMessageId,
          sessionId: id,
          provider: payload.providerId,
          sender: payload.providerId,
          senderName: PROVIDER_NAMES[payload.providerId] || payload.providerId,
          text,
          ...(events ? { events } : {}),
          modelBadge: payload.model,
          reasoningBadge: payload.effort,
          timestamp: new Date().toISOString(),
          // The last one ends now; without milliseconds it would tie with the delivered message and lose.
          createdAt: dbTime(next ? next.at - 1 : Date.now()),
        }),
      ).catch(() => {});
    }
    return out;
  }
  async function stoppedResult(payload, result = {}, started = false) {
    const id = payload.sessionId;
    if (removing.has(id)) return cancelled();
    const text =
      (started
        ? t("session.stoppedByUser")
        : t("session.cancelledBeforeRun")) +
      (result.output ? "\n\n" + t("session.partialOutput") + "\n" + result.output : "");
    if (
      payload.responseMessageId &&
      (await store.sessionExists(id)) &&
      !removing.has(id)
    ) {
      await write(id, () =>
        store.saveChatMessage({
          id: payload.responseMessageId,
          sessionId: id,
          provider: payload.providerId,
          sender: payload.providerId,
          senderName:
            {
              claude: "Claude Code",
              codex: "Codex CLI",
              antigravity: "Antigravity",
            }[payload.providerId] || payload.providerId,
          text,
          events: result.events,
          modelBadge: payload.model,
          reasoningBadge: payload.effort,
          timestamp: new Date().toISOString(),
          ...(result.followUps?.length
            ? { createdAt: dbTime(result.followUps[0].at - 1) }
            : {}),
        }),
      );
    }
    const followUps = await saveFollowUps(payload, result);
    return {
      ok: false,
      cancelled: true,
      stopped: true,
      output: text,
      ...(followUps.length ? { followUps } : {}),
      nativeSessionId: result.nativeSessionId,
    };
  }
  function interrupt(id) {
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,200}$/.test(id)
    )
      return Promise.reject(new Error(t("errors.invalidConversation")));
    if (stopping.has(id)) return stopping.get(id);
    generations.set(id, (generations.get(id) || 0) + 1);
    const tail = turns.get(id);
    runner.kill(id);
    const pending = (async () => {
      await tail?.catch(() => {});
      await writes.get(id)?.catch(() => {});
      return { ok: true, stopped: true };
    })();
    stopping.set(id, pending);
    pending
      .finally(() => {
        if (stopping.get(id) === pending) stopping.delete(id);
      })
      .catch(() => {});
    return pending;
  }
  const validIds = (request) =>
    request &&
    [request.sessionId, request.responseMessageId, request.userMessageId].every(
      (v) => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,200}$/.test(v),
    );
  const waiting = (id) => {
    if (!queuedOrder.has(id)) queuedOrder.set(id, []);
    return queuedOrder.get(id);
  };
  // The message left the wait: it was delivered, discarded or finished.
  function leave(id, responseId) {
    const list = queuedOrder.get(id);
    if (list) {
      const at = list.indexOf(responseId);
      if (at >= 0) list.splice(at, 1);
      if (!list.length) queuedOrder.delete(id);
    }
    reserved.delete(responseId);
  }
  // Only a message still waiting in this conversation's queue, which the CLI hasn't received and
  // isn't about to receive, can be removed/forced.
  const isWaiting = (request) =>
    waiting(request.sessionId).includes(request.responseMessageId) &&
    !reserved.has(request.responseMessageId) &&
    !started.has(request.responseMessageId);
  // Takes a message not yet delivered to the CLI off the queue and deletes what was saved of it.
  async function cancelQueued(request) {
    if (!validIds(request)) return { ok: false, error: t("errors.invalidMessage") };
    const { sessionId, responseMessageId, userMessageId } = request;
    if (!isWaiting(request))
      return { ok: false, error: t("errors.notQueuedAnymore") };
    discarded.add(responseMessageId);
    leave(sessionId, responseMessageId);
    // A save of the message still on its way can't recreate it afterwards.
    droppedUsers.add(userMessageId);
    if (droppedUsers.size > 500) droppedUsers.delete(droppedUsers.values().next().value);
    try {
      await write(sessionId, async () => {
        await store.deleteChatMessage?.(sessionId, userMessageId);
        await store.deleteChatMessage?.(sessionId, responseMessageId);
      });
    } catch {}
    return { ok: true };
  }
  // "Send now": brings down the run in progress; the next in the queue is this one, so only the first
  // waiting message can be forced (the others would keep the order and interrupt what they shouldn't).
  async function forceQueued(request) {
    if (!validIds(request)) return { ok: false, error: t("errors.invalidMessage") };
    if (!isWaiting(request) || waiting(request.sessionId)[0] !== request.responseMessageId)
      return { ok: false, error: t("errors.onlyNextQueued") };
    runner.kill(request.sessionId);
    return { ok: true };
  }
  // "Answer now" for a message already delivered to the CLI (Claude Code and Codex read it on the next
  // step). In Antigravity the message stays in the queue: there "Send now" (forceQueued) applies.
  async function answerNow(request) {
    if (!validIds(request)) return { ok: false, error: t("errors.invalidMessage") };
    if (!["claude", "codex"].includes(request.providerId))
      return { ok: false, error: t("errors.cliReadsAtEnd") };
    const mode = request.mode === "interrupt" ? "interrupt" : "background";
    if (!turns.has(request.sessionId) || typeof runner.answerNow !== "function")
      return { ok: false, error: t("errors.noReplyRunning") };
    return runner.answerNow({ sessionId: request.sessionId, providerId: request.providerId, mode });
  }
  async function execute(payload) {
    const id = payload?.sessionId;
    if (removing.has(id)) return cancelled();
    const responseId = payload?.responseMessageId;
    // Stop applies to what was already sent: the generation and the barrier are read on entry.
    const stopState = {
      generation: generations.get(id) || 0,
      barrier: stopping.get(id),
    };
    payload = { ...payload, __stop: stopState };
    pendingCount.set(id, (pendingCount.get(id) || 0) + 1);
    if (responseId) {
      waiting(id).push(responseId);
      // While the decision (inject or queue) isn't out, the message can't be removed.
      reserved.add(responseId);
    }
    // A conversation's decisions come out in order: a slow injection doesn't let the next one jump the queue.
    const decision = (decisions.get(id) || Promise.resolve()).then(() => decide(payload));
    decisions.set(id, decision.catch(() => {}));
    const outcome = await decision;
    return outcome.result ?? outcome.pending;
  }
  async function decide(payload) {
    const id = payload.sessionId;
    const responseId = payload.responseMessageId;
    const drop = (result) => {
      leave(id, responseId);
      const left = (pendingCount.get(id) || 1) - 1;
      if (left > 0) pendingCount.set(id, left);
      else pendingCount.delete(id);
      return { result };
    };
    if (removing.has(id)) return drop(cancelled());
    // The CLI gets the message mid-run, as in the original CLI (Claude Code: on the next
    // step; Codex: turn/steer). It only goes in if no other message is waiting ahead.
    if (
      turns.has(id) &&
      (pendingCount.get(id) || 0) === 2 &&
      !stopping.has(id) &&
      payload.cancelled !== true &&
      !discarded.has(responseId) &&
      typeof runner.inject === "function"
    ) {
      const delivered = await runner.inject(payload);
      if (delivered) {
        // The message now sits between the reply being written and the next one: the history's
        // order follows the moment of delivery (see `replyTimes`).
        const at = typeof delivered === "object" ? delivered.at : undefined;
        if (at && payload.userMessageId && typeof store.setMessageTime === "function")
          await write(id, () =>
            store.setMessageTime(id, payload.userMessageId, dbTime(at)),
          ).catch(() => {});
        return drop({
          ok: true,
          injected: true,
          ...(typeof delivered === "object" && delivered.from
            ? { rotatedFrom: delivered.from }
            : {}),
          output: "",
        });
      }
    }
    if (removing.has(id)) return drop(cancelled());
    reserved.delete(responseId);
    const { __stop: stop, ...clean } = payload;
    return { pending: enqueue(clean, stop) };
  }
  function enqueue(payload, stop) {
    const id = payload?.sessionId;
    const previous = turns.get(id);
    const generation = stop.generation,
      barrier = stop.barrier;
    const wasStopped = () =>
      payload.cancelled === true || (generations.get(id) || 0) !== generation;
    const pending = (async () => {
      await barrier?.catch(() => {});
      await previous?.catch(() => {});
      await writes.get(id)?.catch(() => {});
      if (removing.has(id) || !(await store.sessionExists(id)))
        return cancelled();
      if (removing.has(id)) return cancelled();
      if (discarded.has(payload.responseMessageId))
        return { ok: false, cancelled: true, discarded: true };
      if (wasStopped()) return stoppedResult(payload);
      started.add(payload.responseMessageId);
      leave(id, payload.responseMessageId);
      const result = await runner.execute(payload);
      if (removing.has(id)) return cancelled();
      if (wasStopped() || result.cancelled)
        return stoppedResult(payload, result, true);
      if (result.context && typeof store.setSessionContext === "function")
        await write(id, () => store.setSessionContext(id, result.context)).catch(() => {});
      if (payload.responseMessageId) {
        try {
          await write(id, () =>
            store.saveChatMessage({
              id: payload.responseMessageId,
              sessionId: id,
              provider: payload.providerId,
              sender: payload.providerId,
              senderName:
                {
                  claude: "Claude Code",
                  codex: "Codex CLI",
                  antigravity: "Antigravity",
                }[payload.providerId] || payload.providerId,
              // With messages delivered mid-turn, the error goes in the last reply.
              text: result.followUps?.length
                ? result.output || ""
                : result.ok
                  ? result.output || t("session.done")
                  : `${t("session.errorPrefix")} ${result.error || t("session.runFailed")}${result.output ? "\n\n" + result.output : ""}`,
              events: result.events,
              modelBadge: payload.model,
              reasoningBadge: payload.effort,
              timestamp: new Date().toISOString(),
              ...(result.followUps?.length
                ? { createdAt: dbTime(result.followUps[0].at - 1) }
                : {}),
            }),
          );
          if (result.followUps?.length) {
            const followUps = await saveFollowUps(
              payload,
              result,
              result.ok ? "" : `${t("session.errorPrefix")} ${result.error || t("session.runFailed")}`,
            );
            return removing.has(id) ? cancelled() : { ...result, followUps };
          }
        } catch (error) {
          if (removing.has(id)) return cancelled();
          return {
            ...result,
            ok: false,
            error: t("errors.replyNotSaved", { error: error.message }),
          };
        }
      }
      return removing.has(id) ? cancelled() : result;
    })();
    turns.set(id, pending);
    pending
      .finally(() => {
        if (turns.get(id) === pending) turns.delete(id);
        const left = (pendingCount.get(id) || 1) - 1;
        if (left > 0) pendingCount.set(id, left);
        else pendingCount.delete(id);
        started.delete(payload.responseMessageId);
        discarded.delete(payload.responseMessageId);
        leave(id, payload.responseMessageId);
        if (decisions.get(id) && !turns.has(id) && !(pendingCount.get(id) || 0))
          decisions.delete(id);
      })
      .catch(() => {});
    return pending;
  }
  function remove(id) {
    if (removing.has(id)) return removing.get(id);
    // Publish the deletion marker before resolving/cancelling the in-flight turn.
    let finish;
    const pending = new Promise((resolve, reject) => {
      finish = { resolve, reject };
    });
    removing.set(id, pending);
    (async () => {
      runner.kill(id);
      await turns.get(id)?.catch(() => {});
      await writes.get(id)?.catch(() => {});
      return store.deleteSessionFromDb(id);
    })()
      .then(finish.resolve, finish.reject)
      .finally(() => removing.delete(id));
    return pending;
  }
  return {
    execute,
    interrupt,
    cancelQueued,
    forceQueued,
    answerNow,
    isBusy: () => turns.size > 0,
    // Sessions with a turn running or queued (the queue waits inside `turns`).
    activeCount: () => turns.size,
    activeIds: () => [...turns.keys()],
    remove,
    // Turn the CLI started on its own (main agent replying after a background
    // agent): saved as a new reply of the conversation.
    saveAutoTurn: async (p) => {
      if (!p || p.discard || !p.responseMessageId) return;
      try {
        if (!(await store.sessionExists(p.sessionId))) return;
        const names = { claude: "Claude Code", codex: "Codex CLI", antigravity: "Antigravity" };
        await write(p.sessionId, async () => {
          await store.saveChatMessage({
            id: p.responseMessageId,
            sessionId: p.sessionId,
            provider: p.providerId,
            sender: p.providerId,
            senderName: names[p.providerId] || p.providerId,
            text: p.ok
              ? p.text || t("session.done")
              : `${t("session.errorPrefix")} ${p.error || t("session.runFailed")}${p.text ? "\n\n" + p.text : ""}`,
            events: p.events,
            modelBadge: p.model,
            timestamp: new Date().toISOString(),
          });
          if (p.context && typeof store.setSessionContext === "function")
            await store.setSessionContext(p.sessionId, p.context);
        });
      } catch {}
    },
    saveLateEvents: ({ sessionId, responseMessageId, events }) =>
      typeof store.mergeMessageEvents === "function"
        ? write(sessionId, () =>
            store.mergeMessageEvents(sessionId, responseMessageId, events),
          ).catch(() => {})
        : Promise.resolve(),
    setSessionContext: (id, context) =>
      write(id, () => store.setSessionContext(id, context)),
    // Closing (archived) stops the CLI process; with a reply in progress, the person stops it first.
    setSessionArchived: (id, archived) => {
      if (archived && turns.has(id))
        return Promise.reject(
          new Error(t("session.stopBeforeClose")),
        );
      if (archived) runner.kill(id);
      return write(id, () => store.setSessionArchived(id, archived));
    },
    saveSession: (session) =>
      write(session.id, () => store.saveSession(session)),
    saveChatMessage: (message) =>
      droppedUsers.has(message.id)
        ? Promise.resolve({ success: true })
        : write(message.sessionId, () => store.saveChatMessage(message)),
    replaceChatMessages: (id, messages) => {
      if (turns.has(id))
        return Promise.reject(
          new Error(t("errors.waitBeforeImport")),
        );
      return write(id, () => store.replaceChatMessages(id, messages));
    },
  };
}
module.exports = { createSessionService };
