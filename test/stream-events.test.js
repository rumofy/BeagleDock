const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createEventTracker } = require("../electron/stream-events");

test("the tracker publishes each change, measures duration and limits the text", () => {
  let clock = 1000;
  const sent = [];
  const tracker = createEventTracker({ emit: (ch, d) => sent.push([ch, d]), sessionId: "s1", now: () => clock });
  tracker.start("resp");
  tracker.upsert("a", { kind: "command", title: "Bash" });
  clock = 1500;
  tracker.finish("a", "done");
  assert.equal(sent.length, 2);
  assert.equal(sent[0][0], "cli-activity-event");
  assert.equal(sent[0][1].responseMessageId, "resp");
  assert.equal(sent[1][1].event.durationMs, 500);
  assert.equal(sent[1][1].event.status, "done");
  tracker.finish("a", "error");
  assert.equal(sent.length, 2, "a finished event doesn't change again");
  tracker.upsert("t", { kind: "reasoning", title: "x" });
  tracker.appendText("t", "y".repeat(5000));
  assert.ok(tracker.get("t").text.length <= 4000);
});

test("reasoning text is published at most every 120 ms, but is never lost", () => {
  let clock = 0;
  const sent = [];
  const tracker = createEventTracker({ emit: (_c, d) => sent.push(d.event), sessionId: "s", now: () => clock });
  tracker.start("r");
  tracker.upsert("t", { kind: "reasoning", title: "R" });
  const before = sent.length;
  for (let i = 0; i < 10; i++) {
    clock += 10;
    tracker.appendText("t", "a");
  }
  assert.ok(sent.length - before <= 2);
  tracker.finishRunning();
  assert.equal(sent.at(-1).text, "aaaaaaaaaa");
  assert.equal(sent.at(-1).status, "done");
});

test("start() clears the timeline between replies", () => {
  const tracker = createEventTracker({ sessionId: "s" });
  tracker.start("r1");
  tracker.upsert("a", { kind: "tool", title: "T" });
  tracker.start("r2");
  assert.deepEqual(tracker.snapshot(), []);
});

test("a background agent survives the end of the turn and the start of the next, in the original reply", () => {
  const sent = [], late = [];
  const t = createEventTracker({ emit: (_c, d) => sent.push(d), sessionId: "s", onLate: (p) => late.push(p), setTimer: (fn) => fn });
  t.start("r1");
  t.upsert("cmd", { kind: "command", title: "Bash" });
  t.upsert("ag", { kind: "agent", title: "Agente x", meta: { background: true } });
  t.upsert("ag-cmd", { kind: "command", title: "Bash", parentId: "ag" });
  t.finishRunning();
  assert.equal(t.get("cmd").status, "done", "the ordinary command is closed");
  assert.equal(t.get("ag").status, "running", "the background agent isn't");
  assert.equal(t.get("ag-cmd").status, "running", "nor its steps");
  t.endTurn();
  t.start("r2"); // the person sends another message
  t.upsert("novo", { kind: "tool", title: "T" });
  assert.deepEqual(t.snapshot().map((e) => e.id), ["novo"], "the new reply doesn't inherit the old steps");
  // The agent reports progress and finishes: it goes to the reply that launched it (r1), not to r2.
  t.upsert("ag", { meta: { tokens: 500 } });
  t.upsert("ag-cmd2", { kind: "command", title: "Bash", parentId: "ag" });
  t.finish("ag-cmd", "done");
  t.finish("ag", "done", { text: "resultado" });
  const toOld = sent.filter((d) => d.responseMessageId === "r1" && ["ag", "ag-cmd", "ag-cmd2"].includes(d.event.id));
  assert.ok(toOld.length >= 4, "late events published in the original reply");
  assert.ok(sent.filter((d) => d.responseMessageId === "r2").every((d) => d.event.id === "novo"));
  t.flushLate();
  const last = late.filter((p) => p.responseMessageId === "r1").at(-1);
  assert.equal(last.events.find((e) => e.id === "ag").status, "done");
  assert.equal(last.events.find((e) => e.id === "ag").text, "resultado");
  assert.equal(last.events.find((e) => e.id === "ag-cmd2").parentId, "ag");
});

test("a late update with the turn already over also notifies so it's saved", () => {
  const late = [];
  const t = createEventTracker({ sessionId: "s", onLate: (p) => late.push(p), setTimer: (fn) => fn });
  t.start("r1");
  t.upsert("ag", { kind: "agent", title: "A", meta: { background: true } });
  t.finishRunning();
  t.endTurn();
  t.upsert("ag", { meta: { toolUses: 2 } });
  t.flushLate();
  assert.equal(late.at(-1).responseMessageId, "r1");
  assert.equal(late.at(-1).events[0].meta.toolUses, 2);
});

test("a loose reply with nothing in progress is forgotten", () => {
  const t = createEventTracker({ sessionId: "s", setTimer: (fn) => fn });
  t.start("r1");
  t.upsert("ag", { kind: "agent", title: "A", meta: { background: true } });
  t.finishRunning();
  t.endTurn();
  t.start("r2");
  t.finish("ag", "done");
  t.flushLate();
  assert.equal(t.get("ag"), undefined);
});

test("a message delivered mid-turn: new steps go to the new reply, old ones finish in the previous", () => {
  const sent = [], late = [];
  const t = createEventTracker({ emit: (_c, d) => sent.push(d), sessionId: "s", onLate: (p) => late.push(p), setTimer: (fn) => fn });
  t.start("r1");
  t.upsert("cmd", { kind: "command", title: "Bash" });
  t.upsert("bg", { kind: "command", title: "Bash", meta: { background: true } });
  t.rotate("r2");
  t.upsert("think", { kind: "reasoning", title: "Raciocínio" });
  t.finish("cmd", "error");
  assert.equal(sent.find((d) => d.event.id === "think").responseMessageId, "r2");
  assert.equal(sent.filter((d) => d.event.id === "cmd").at(-1).responseMessageId, "r1", "the old step finishes in its own reply");
  assert.equal(late.length, 0, "during the turn, the previous reply isn't a late update");
  t.rotate("r3");
  t.upsert("tool", { kind: "tool", title: "Read" });
  t.finishRunning();
  assert.equal(t.get("think").status, "done", "what was left running in previous replies also closes");
  assert.equal(t.get("bg").status, "running", "the background command doesn't");
  assert.deepEqual(t.snapshotFor("r1").map((e) => e.id), ["cmd", "bg"]);
  assert.deepEqual(t.snapshotFor("r2").map((e) => e.id), ["think"]);
  assert.deepEqual(t.snapshotFor("r3").map((e) => e.id), ["tool"]);
  t.endTurn();
  t.finish("bg", "done");
  t.flushLate();
  assert.equal(late.at(-1).responseMessageId, "r1", "after the turn, the background command updates the original reply");
  t.start("r4");
  assert.deepEqual(t.snapshotFor("r2"), [], "the next turn forgets replies with nothing running");
});

test("a proposed plan is kept in full while ordinary step text keeps only its tail", () => {
  const tracker = createEventTracker({ emit: () => {}, sessionId: "s", now: () => 0 });
  tracker.start("r");
  const plan = "# Plan\n" + "step\n".repeat(2000);
  tracker.upsert("p", { kind: "plan", title: "Plano proposto", text: plan, meta: { proposal: true } });
  assert.equal(tracker.get("p").text, plan);
});
