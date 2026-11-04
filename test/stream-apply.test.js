const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./load-ts.cjs");
const load = (file) => loadTs(file, { globals: { setTimeout, clearTimeout, performance } });
const { createFrameBatcher, createFrameScheduler } = load("src/lib/frameBatcher.ts");
const { applyStreamItems } = load("src/lib/streamApply.ts");
const { percentile, recordStreamSample, getStreamStats, resetStreamStats } = load("src/lib/streamMetrics.ts");
const { formatDuration } = load("src/lib/duration.ts");
// Objects created in the vm have another prototype; compare the content, not the reference.
const plain = (value) => JSON.parse(JSON.stringify(value));

const msg = (extra = {}) => ({
  id: "r1",
  sessionId: "s1",
  sender: "claude",
  senderName: "Claude",
  text: "",
  timestamp: "",
  isStreaming: true,
  startedAt: 1000,
  ...extra,
});
const chunk = (payload, receivedAt = 0) => ({ kind: "chunk", payload: { sessionId: "s1", responseMessageId: "r1", ...payload }, receivedAt });
const event = (e, receivedAt = 0) => ({ kind: "event", payload: { sessionId: "s1", responseMessageId: "r1", event: e }, receivedAt });

test("the batcher delivers everything, in order, in a single flush per frame", () => {
  const flushes = [];
  let run;
  const batcher = createFrameBatcher((items) => flushes.push(items), (cb) => (run = cb));
  batcher.push(1);
  batcher.push(2);
  batcher.push(3);
  assert.equal(flushes.length, 0);
  assert.equal(batcher.pending(), 3);
  run();
  assert.deepEqual(plain(flushes), [[1, 2, 3]]);
  batcher.push(4);
  run();
  assert.deepEqual(plain(flushes), [[1, 2, 3], [4]]);
});

test("a batch of chunks becomes a single update and preserves the other messages", () => {
  const other = msg({ id: "r0", isStreaming: false, text: "antiga" });
  const prev = { s1: [other, msg()], s2: [msg({ id: "x", sessionId: "s2" })] };
  const next = applyStreamItems(prev, [chunk({ fullText: "Olá" }), chunk({ fullText: "Olá mundo" })], 5000);
  assert.equal(next.s1[1].text, "Olá mundo");
  assert.equal(next.s1[0], other, "an old message keeps its identity (memo doesn't re-render)");
  assert.equal(next.s2, prev.s2);
  assert.notEqual(next.s1, prev.s1);
  assert.equal(prev.s1[1].text, "", "the previous state isn't mutated");
});

test("real progress updates lastProgressAt; a repeated sign of life only updates lastEventAt", () => {
  let state = applyStreamItems({ s1: [msg()] }, [chunk({ activity: "Raciocinando…" })], 2000);
  assert.equal(state.s1[0].lastProgressAt, 2000);
  assert.equal(state.s1[0].activitySince, 2000);
  state = applyStreamItems(state, [chunk({ activity: "Raciocinando…" })], 9000);
  assert.equal(state.s1[0].lastEventAt, 9000);
  assert.equal(state.s1[0].lastProgressAt, 2000, "the same repeated activity isn't progress");
  assert.equal(state.s1[0].activitySince, 2000);
  state = applyStreamItems(state, [chunk({ activity: "Executando comando…", detail: "npm test" })], 12000);
  assert.equal(state.s1[0].lastProgressAt, 12000);
  assert.equal(state.s1[0].detail, "npm test");
  state = applyStreamItems(state, [chunk({ fullText: "texto novo" })], 15000);
  assert.equal(state.s1[0].lastProgressAt, 15000);
});

test("timeline events come in order and are updated by id", () => {
  const e = (extra) => ({ id: "t1", kind: "command", title: "Bash", status: "running", ...extra });
  let state = applyStreamItems({ s1: [msg()] }, [event(e()), event(e({ id: "t2", kind: "reasoning", title: "R" }))], 3000);
  assert.deepEqual(plain(state.s1[0].events.map((x) => x.id)), ["t1", "t2"]);
  state = applyStreamItems(state, [event(e({ status: "done", durationMs: 40 }))], 4000);
  assert.equal(state.s1[0].events.length, 2);
  assert.equal(state.s1[0].events[0].status, "done");
  assert.equal(state.s1[0].lastProgressAt, 4000);
  state = applyStreamItems(state, [event(e({ status: "done", durationMs: 40 }))], 8000);
  assert.equal(state.s1[0].lastProgressAt, 4000, "an identical event is only a sign of life");
  assert.equal(state.s1[0].lastEventAt, 8000);
});

test("events of already finished messages or of another reply are ignored", () => {
  const done = { s1: [msg({ isStreaming: false })] };
  assert.equal(applyStreamItems(done, [chunk({ fullText: "x" })], 1), done);
  const other = { s1: [msg()] };
  assert.equal(applyStreamItems(other, [chunk({ responseMessageId: "outra", fullText: "x" })], 1), other);
});

test("ANSI is removed from the received text", () => {
  const next = applyStreamItems({ s1: [msg()] }, [chunk({ fullText: "\x1b[31mvermelho\x1b[0m" })], 1);
  assert.equal(next.s1[0].text, "vermelho");
});

test("metrics: percentiles and the sum of the delay's stages", () => {
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([10, 20, 30, 40, 50], 50), 30);
  assert.equal(percentile([1, 2, 3, 4, 100], 95), 100);
  resetStreamStats();
  for (let i = 1; i <= 20; i++) recordStreamSample({ ipcMs: i, frameWaitMs: 5, commitMs: 2 });
  const stats = getStreamStats();
  assert.equal(stats.count, 20);
  assert.equal(stats.p50, 17);
  assert.equal(stats.max, 27);
  recordStreamSample({ ipcMs: -5, frameWaitMs: 0, commitMs: 0 });
  assert.equal(getStreamStats().count, 20, "an invalid sample is discarded");
});

test("readable duration", () => {
  assert.equal(formatDuration(850), "850 ms");
  assert.equal(formatDuration(4200), "4.2 s");
  assert.equal(formatDuration(125000), "2:05");
  assert.equal(formatDuration(-1), "");
});

test("the scheduler uses the animation frame and cancels the safety timeout", () => {
  const calls = [];
  let frame, timer, cleared = null;
  const schedule = createFrameScheduler({
    raf: (cb) => (frame = cb),
    setTimer: (cb, ms) => ((timer = cb), (calls.push(ms), "t1")),
    clearTimer: (id) => (cleared = id),
  });
  let runs = 0;
  schedule(() => runs++);
  assert.deepEqual(plain(calls), [50]);
  frame();
  timer();
  assert.equal(runs, 1, "runs a single time");
  assert.equal(cleared, "t1");
});

test("with the window hidden the frame doesn't come and the safety timeout delivers the batch", () => {
  let timer;
  const schedule = createFrameScheduler({
    raf: () => undefined,
    setTimer: (cb) => (timer = cb),
    clearTimer: () => {},
  });
  const flushed = [];
  const batcher = createFrameBatcher((items) => flushed.push(...items), schedule);
  batcher.push("a");
  batcher.push("b");
  assert.equal(flushed.length, 0);
  timer();
  assert.deepEqual(plain(flushed), ["a", "b"]);
});

test("an event without a reply id only counts with a single streaming message", () => {
  const first = msg({ id: "a", text: "" });
  const second = msg({ id: "b", text: "" });
  const queued = { s1: [first, second] };
  assert.equal(applyStreamItems(queued, [chunk({ responseMessageId: undefined, activity: "Na fila" })], 1), queued, "ambiguous: ignored");
  const single = { s1: [msg({ id: "a" })] };
  const next = applyStreamItems(single, [chunk({ responseMessageId: undefined, fullText: "ok" })], 1);
  assert.equal(next.s1[0].text, "ok");
});

test("a batch pending when the turn ends doesn't reopen or change the final reply", () => {
  const finished = { s1: [msg({ isStreaming: false, text: "texto final", events: [{ id: "e", kind: "command", title: "B", status: "done" }] })] };
  const next = applyStreamItems(
    finished,
    [chunk({ fullText: "parcial atrasado" }), event({ id: "e", kind: "command", title: "B", status: "running" })],
    9,
  );
  assert.equal(next, finished);
  assert.equal(next.s1[0].text, "texto final");
  assert.equal(next.s1[0].events[0].status, "done");
});

test("several chunks of the same text in one frame: the last one wins, and all count as progress", () => {
  const prev = { s1: [msg({ lastProgressAt: 100 })] };
  const next = applyStreamItems(prev, [
    chunk({ fullText: "Ol" }, 0), chunk({ fullText: "Olá" }, 0), chunk({ fullText: "Olá \x1b[31mmundo\x1b[0m", activity: "IA respondendo…" }, 0),
  ], 5000);
  assert.equal(next.s1[0].text, "Olá mundo");
  assert.equal(next.s1[0].lastProgressAt, 5000);
  assert.equal(next.s1[0].activity, "IA respondendo…");
  // different messages in the same frame don't interfere with each other
  const two = { s1: [msg({ id: "a" }), msg({ id: "b" })] };
  const both = applyStreamItems(two, [
    chunk({ responseMessageId: "a", fullText: "A1" }), chunk({ responseMessageId: "b", fullText: "B1" }), chunk({ responseMessageId: "a", fullText: "A2" }),
  ], 1);
  assert.equal(both.s1[0].text, "A2");
  assert.equal(both.s1[1].text, "B1");
});

test("a finished reply still gets updates from agents it already has (and from child steps), nothing else", () => {
  const finished = { s1: [msg({ isStreaming: false, text: "final", events: [{ id: "ag", kind: "agent", title: "A", status: "running", meta: { background: true } }] })] };
  const upd = applyStreamItems(finished, [event({ id: "ag", kind: "agent", title: "A", status: "done", text: "ok" })], 5);
  assert.equal(upd.s1[0].events[0].status, "done");
  assert.equal(upd.s1[0].text, "final", "the reply's text doesn't change");
  const child = applyStreamItems(upd, [event({ id: "filho", parentId: "ag", kind: "command", title: "B", status: "running" })], 6);
  assert.deepEqual(plain(child.s1[0].events.map((e) => e.id)), ["ag", "filho"]);
  // a step unrelated to the reply, or late text, stays ignored
  const stray = applyStreamItems(child, [event({ id: "estranho", kind: "tool", title: "X", status: "running" }), chunk({ fullText: "texto atrasado" })], 7);
  assert.equal(stray, child);
});

test("a delivered and still unread message: the activity notice doesn't mark it as read; new text or a new step does", () => {
  const delivered = { s1: [msg({ deliveredFor: "u1", activity: "Entregue" })] };
  const afterActivity = applyStreamItems(delivered, [chunk({ fullText: "", activity: "Mensagem nova recebida" })]);
  assert.equal(afterActivity.s1[0].deliveredFor, "u1");
  const afterText = applyStreamItems(delivered, [chunk({ fullText: "RESPOSTA=42" })]);
  assert.equal(afterText.s1[0].deliveredFor, undefined);
  const afterEvent = applyStreamItems(delivered, [event({ id: "e1", kind: "command", title: "ls", status: "running" })]);
  assert.equal(afterEvent.s1[0].deliveredFor, undefined);
});
