const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSessionService } = require("../electron/session-service");

function setup({ inject = () => false } = {}) {
  const saved = [], deleted = [], kills = [], times = [];
  const gates = [];
  const started = [];
  const runner = {
    inject,
    kill: (id) => {
      kills.push(id);
      gates.shift()?.({ ok: false, cancelled: true, output: "parcial" });
    },
    execute: (payload) => {
      started.push(payload.responseMessageId);
      return new Promise((resolve) => gates.push(resolve));
    },
  };
  const store = {
    sessionExists: async () => true,
    saveChatMessage: async (m) => saved.push(m),
    deleteChatMessage: async (s, id) => deleted.push(id),
    setMessageTime: async (...args) => times.push(args),
    setSessionContext: async () => {},
    deleteSessionFromDb: async () => {},
  };
  return { service: createSessionService({ store, runner }), saved, deleted, kills, gates, started, times };
}
const p = (n, extra = {}) => ({ sessionId: "s1", providerId: "claude", responseMessageId: `r${n}`, prompt: `m${n}` , ...extra });
const tick = () => new Promise((r) => setImmediate(r));

test("a queued message removed before the CLI receives it never reaches the CLI and is deleted from the history", async () => {
  const t = setup();
  const first = t.service.execute(p(1));
  await tick();
  const second = t.service.execute(p(2));
  await tick();
  const third = t.service.execute(p(3));
  const removed = await t.service.cancelQueued({ sessionId: "s1", responseMessageId: "r2", userMessageId: "u2" });
  assert.equal(removed.ok, true);
  assert.deepEqual(t.deleted.sort(), ["r2", "u2"]);
  t.gates.shift()({ ok: true, output: "um" });
  assert.equal((await first).ok, true);
  assert.equal((await second).discarded, true);
  await tick(); await tick();
  assert.deepEqual(t.started, ["r1", "r3"], "the removed message was skipped");
  t.gates.shift()({ ok: true, output: "três" });
  assert.equal((await third).output, "três");
});

test("doesn't remove from the queue a message the CLI already received", async () => {
  const t = setup();
  const first = t.service.execute(p(1));
  await tick(); await tick();
  const res = await t.service.cancelQueued({ sessionId: "s1", responseMessageId: "r1", userMessageId: "u1" });
  assert.equal(res.ok, false);
  assert.deepEqual(t.deleted, []);
  t.gates.shift()({ ok: true, output: "x" });
  await first;
});

test("send now interrupts only the current run and the queued message is next", async () => {
  const t = setup();
  const first = t.service.execute(p(1));
  await tick();
  const second = t.service.execute(p(2));
  await tick(); await tick();
  const res = await t.service.forceQueued({ sessionId: "s1", responseMessageId: "r2", userMessageId: "u2" });
  assert.equal(res.ok, true);
  assert.deepEqual(t.kills, ["s1"]);
  const stopped = await first;
  assert.equal(stopped.cancelled, true);
  await tick(); await tick();
  assert.deepEqual(t.started, ["r1", "r2"], "the second one wasn't cancelled along");
  t.gates.shift()({ ok: true, output: "dois" });
  assert.equal((await second).output, "dois");
});

test("during a Claude run, the message is delivered to the current turn instead of waiting for the end", async () => {
  const injected = [];
  const t = setup({ inject: (payload) => (injected.push(payload.prompt), true) });
  const first = t.service.execute(p(1));
  await tick();
  const second = await t.service.execute(p(2));
  assert.equal(second.injected, true);
  assert.deepEqual(injected, ["m2"]);
  assert.deepEqual(t.started, ["r1"]);
  t.gates.shift()({ ok: true, output: "tudo" });
  await first;
});

test("with a message already waiting in the queue, the next one doesn't jump the order into the current turn", async () => {
  let allow = false;
  const injected = [];
  const t = setup({ inject: (payload) => allow && (injected.push(payload.prompt), true) });
  const first = t.service.execute(p(1));
  await tick();
  const second = t.service.execute(p(2)); // the CLI didn't accept it: waits in the queue
  await tick();
  allow = true;
  const third = t.service.execute(p(3)); // there's one ahead: also waits
  await tick();
  assert.deepEqual(injected, []);
  t.gates.shift()({ ok: true, output: "um" });
  await first;
  await tick(); await tick();
  t.gates.shift()({ ok: true, output: "dois" });
  await second;
  await tick(); await tick();
  t.gates.shift()({ ok: true, output: "três" });
  assert.equal((await third).output, "três");
  assert.deepEqual(t.started, ["r1", "r2", "r3"]);
});

test("send now only applies to the next in the queue; an already finished message can't be removed or forced", async () => {
  const t = setup();
  const first = t.service.execute(p(1));
  await tick();
  const second = t.service.execute(p(2));
  await tick();
  const third = t.service.execute(p(3));
  await tick();
  const forceThird = await t.service.forceQueued({ sessionId: "s1", responseMessageId: "r3", userMessageId: "u3" });
  assert.equal(forceThird.ok, false, "r2 is ahead of r3");
  assert.deepEqual(t.kills, []);
  t.gates.shift()({ ok: true, output: "um" });
  await first;
  await tick(); await tick();
  t.gates.shift()({ ok: true, output: "dois" });
  await second;
  await tick(); await tick();
  const staleRemove = await t.service.cancelQueued({ sessionId: "s1", responseMessageId: "r2", userMessageId: "u2" });
  const staleForce = await t.service.forceQueued({ sessionId: "s1", responseMessageId: "r2", userMessageId: "u2" });
  assert.equal(staleRemove.ok, false);
  assert.equal(staleForce.ok, false);
  assert.deepEqual(t.deleted, [], "r2's history wasn't deleted");
  assert.deepEqual(t.kills, [], "r3's turn wasn't brought down");
  t.gates.shift()({ ok: true, output: "três" });
  await third;
});

test("a message removed from the queue isn't recreated by a save that arrives later", async () => {
  const t = setup();
  const first = t.service.execute(p(1));
  await tick();
  const second = t.service.execute(p(2));
  await tick();
  await t.service.cancelQueued({ sessionId: "s1", responseMessageId: "r2", userMessageId: "u2" });
  await t.service.saveChatMessage({ id: "u2", sessionId: "s1", sender: "user", text: "m2" });
  assert.equal(t.saved.some((m) => m.id === "u2"), false);
  t.gates.shift()({ ok: true, output: "um" });
  await first;
  await second;
});

test("a message in an injection decision can't be removed", async () => {
  let release;
  const t = setup({ inject: () => new Promise((r) => (release = r)) });
  const first = t.service.execute(p(1));
  await tick();
  const second = t.service.execute(p(2));
  await tick();
  const res = await t.service.cancelQueued({ sessionId: "s1", responseMessageId: "r2", userMessageId: "u2" });
  assert.equal(res.ok, false);
  release(true);
  assert.equal((await second).injected, true);
  t.gates.shift()({ ok: true });
  await first;
});

test("a message delivered mid-turn: the reply to it is saved after it and the history's order follows the screen", async () => {
  const at = Date.UTC(2026, 10, 1, 12, 0, 20, 123);
  const t = setup({ inject: () => ({ from: "r1", at }) });
  const first = t.service.execute(p(1));
  await tick();
  const second = await t.service.execute(p(2, { userMessageId: "u2" }));
  assert.equal(second.injected, true);
  assert.equal(second.rotatedFrom, "r1");
  assert.deepEqual(t.times, [["s1", "u2", "2026-11-01 12:00:20.123"]], "the user's message counts from the delivery");
  t.gates.shift()({ ok: true, output: "antes", followUps: [{ responseMessageId: "r2", at, text: "depois" }] });
  const result = await first;
  assert.deepEqual(result.followUps, [{ responseMessageId: "r2", text: "depois" }]);
  const byId = Object.fromEntries(t.saved.map((m) => [m.id, m]));
  assert.equal(byId.r1.text, "antes");
  assert.equal(byId.r1.createdAt, "2026-11-01 12:00:20.122", "the first reply sits right before the message");
  assert.equal(byId.r2.text, "depois");
  assert.ok(byId.r2.createdAt > byId.r1.createdAt, "the last reply ends after the delivered message");
});

test("a reply to the delivered message without text isn't saved and goes empty to the screen", async () => {
  const at = Date.now();
  const t = setup({ inject: () => ({ from: "r1", at }) });
  const first = t.service.execute(p(1));
  await tick();
  await t.service.execute(p(2));
  t.gates.shift()({ ok: true, output: "tudo", followUps: [{ responseMessageId: "r2", at, text: "" }] });
  const result = await first;
  assert.deepEqual(result.followUps, [{ responseMessageId: "r2", text: "" }]);
  assert.deepEqual(t.saved.map((m) => m.id), ["r1"]);
});

test("a reply to the delivered message with only steps is saved with them", async () => {
  const at = Date.now();
  const t = setup({ inject: () => ({ from: "r1", at }) });
  const first = t.service.execute(p(1));
  await tick();
  await t.service.execute(p(2));
  const events = [{ id: "e1", kind: "tool", title: "Read", status: "done" }];
  t.gates.shift()({ ok: true, output: "tudo", followUps: [{ responseMessageId: "r2", at, text: "", events }] });
  const result = await first;
  assert.deepEqual(result.followUps, [{ responseMessageId: "r2", text: "", events }]);
  const r2 = t.saved.find((m) => m.id === "r2");
  assert.deepEqual(r2?.events, events);
});

test("answer now goes to the runner only with a reply in progress and only in Claude and Codex", async () => {
  const calls = [];
  const t = setup({ inject: async () => ({ at: Date.now() }) });
  // The setup's runner has no answerNow: without it, it refuses.
  const first = t.service.execute(p(1));
  await tick(); await tick();
  const req = { sessionId: "s1", responseMessageId: "r2", userMessageId: "u2", providerId: "claude", mode: "background" };
  assert.equal((await t.service.answerNow(req)).ok, false);
  t.gates.shift()({ ok: true, output: "x" });
  await first;

  const runner = {
    inject: async () => ({ at: Date.now() }),
    answerNow: async (r) => (calls.push(r), { ok: true, mode: r.mode }),
    kill() {},
    execute: () => new Promise(() => {}),
  };
  const service = createSessionService({
    store: { sessionExists: async () => true, saveChatMessage: async () => {}, setMessageTime: async () => {} },
    runner,
  });
  assert.equal((await service.answerNow(req)).ok, false, "no reply in progress");
  void service.execute(p(1));
  await tick(); await tick();
  assert.equal((await service.answerNow({ ...req, providerId: "antigravity" })).ok, false, "AGY uses the queue");
  assert.equal((await service.answerNow({ ...req, sessionId: "../x" })).ok, false);
  assert.deepEqual(await service.answerNow({ ...req, mode: "qualquer" }), { ok: true, mode: "background" });
  assert.deepEqual(await service.answerNow({ ...req, providerId: "codex", mode: "interrupt" }), { ok: true, mode: "interrupt" });
  assert.deepEqual(calls.map((c) => [c.providerId, c.mode]), [["claude", "background"], ["codex", "interrupt"]]);
});
