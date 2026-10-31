const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { PassThrough, Writable } = require("stream");
const { createCliRunner } = require("../electron/cli-runner");
const tick = () => new Promise((r) => setImmediate(r));
function harness() {
  const links = new Map(),
    calls = [],
    events = [];
  let wrong = false;
  const store = {
    getNativeSession: async (id) => links.get(id),
    setNativeSession: async (id, p, nativeId, cwd) =>
      links.set(id, { nativeId, cwd }),
  };
  const spawn = (bin, args, options) => {
    const child = new EventEmitter();
    Object.assign(child, {
      exitCode: null,
      killed: false,
      pid: 100 + calls.length,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      messages: [],
    });
    child.event = (ev) => child.stdout.write(JSON.stringify(ev) + "\n");
    child.close = (code) => {
      child.exitCode = code;
      child.emit("close", code);
    };
    child.kill = () => {
      child.killed = true;
      queueMicrotask(() => child.close(143));
    };
    child.stdin = new Writable({
      write(chunk, enc, done) {
        const m = JSON.parse(chunk.toString());
        child.messages.push(m);
        queueMicrotask(() => {
          if (m.method === "initialize") child.event({ id: m.id, result: {} });
          else if (
            m.method === "thread/start" ||
            m.method === "thread/resume"
          ) {
            child.threadId = wrong
              ? "different-native-123"
              : m.params.threadId || "native-codex-123";
            child.event({
              id: m.id,
              result: { thread: { id: child.threadId } },
            });
          } else if (m.method === "turn/start") {
            child.turnId = `turn-${child.messages.filter((m) => m.method === "turn/start").length}`;
            child.event({ id: m.id, result: { turn: { id: child.turnId } } });
          }
        });
        done();
      },
    });
    calls.push({ child, bin, args, options });
    return child;
  };
  const make = () =>
    createCliRunner({
      store,
      spawn,
      find: () => "/fixture/codex",
      checkCwd: (c) => c,
      turnTimeout: 2000,
      emit: (channel, data) => events.push({ channel, data }),
    });
  const notify = (method, params = {}) => {
    const c = calls.at(-1).child;
    c.event({
      method,
      params: { threadId: c.threadId, turnId: c.turnId, ...params },
    });
  };
  return { make, links, calls, events, notify, setWrong: () => (wrong = true) };
}
const payload = {
  providerId: "codex",
  sessionId: "session-codex",
  prompt: "run tests",
  cwd: "/fixture/project",
  permission: "full",
  effort: "high",
  responseMessageId: "response-1",
};
test("Codex app-server emits command and chat deltas before turn completion, with no repeated final output", async () => {
  const h = harness(),
    runner = h.make(),
    pending = runner.execute(payload);
  await tick();
  const c = h.calls[0].child;
  assert.equal(h.calls[0].args[0], "app-server");
  assert.ok(h.calls[0].args.includes('sandbox_mode="danger-full-access"'));
  assert.equal(h.links.get(payload.sessionId).nativeId, "native-codex-123");
  h.notify("item/started", {
    item: { id: "cmd-1", type: "commandExecution", command: "npm test" },
  });
  h.notify("item/commandExecution/outputDelta", {
    itemId: "cmd-1",
    delta: "test one passed\n",
  });
  assert.equal(runner.isBusy(payload.sessionId), true);
  assert.match(
    h.events
      .filter((e) => e.channel === "pty-data")
      .map((e) => e.data.data)
      .join(""),
    /test one passed/,
  );
  h.notify("item/agentMessage/delta", {
    itemId: "answer-1",
    delta: "partial ",
  });
  h.notify("item/agentMessage/delta", { itemId: "answer-1", delta: "answer" });
  assert.equal(
    h.events.filter((e) => e.channel === "cli-stream-chunk").at(-1).data
      .fullText,
    "partial answer",
  );
  assert.equal(
    h.events.filter((e) => e.channel === "cli-stream-chunk").at(-1).data
      .responseMessageId,
    "response-1",
  );
  h.notify("item/completed", {
    item: {
      id: "cmd-1",
      type: "commandExecution",
      aggregatedOutput: "test one passed\n",
    },
  });
  assert.equal(
    h.events
      .filter((e) => e.channel === "pty-data")
      .map((e) => e.data.data)
      .join("")
      .split("test one passed").length - 1,
    1,
  );
  h.notify("turn/completed", { turn: { id: c.turnId, status: "completed" } });
  assert.equal((await pending).output, "partial answer");
  runner.shutdown();
});
test("Codex keeps the same process and native thread for turns, then resumes strictly after restart", async () => {
  const h = harness();
  let runner = h.make();
  for (let i = 0; i < 2; i++) {
    const p = runner.execute(payload);
    await tick();
    h.notify("turn/completed", { turn: { status: "completed" } });
    assert.equal((await p).nativeSessionId, "native-codex-123");
  }
  assert.equal(h.calls.length, 1);
  runner.shutdown();
  await tick();
  runner = h.make();
  const third = runner.execute(payload);
  await tick();
  assert.equal(h.calls.length, 2);
  assert.equal(
    h.calls[1].child.messages.find((m) => m.method === "thread/resume").params
      .threadId,
    "native-codex-123",
  );
  assert.equal(
    h.calls[1].child.messages.some((m) => m.method === "thread/start"),
    false,
  );
  h.notify("turn/completed", { turn: { status: "completed" } });
  await third;
  runner.shutdown();
});
test("Codex rejects overlapping turns, wrong cwd, unexpected native id and failed turns; approvals never grant extra access", async () => {
  const h = harness(),
    runner = h.make();
  let pending = runner.execute(payload);
  await tick();
  assert.equal((await runner.execute(payload)).ok, false);
  const c = h.calls[0].child;
  c.event({
    id: 501,
    method: "item/commandExecution/requestApproval",
    params: { threadId: c.threadId },
  });
  assert.deepEqual(c.messages.at(-1), {
    id: 501,
    result: { decision: "decline" },
  });
  h.notify("turn/completed", {
    turn: { status: "failed", error: { message: "provider quota exhausted" } },
  });
  assert.match((await pending).error, /quota/);
  assert.equal((await runner.execute({ ...payload, cwd: "/other" })).ok, false);
  h.setWrong();
  pending = runner.execute({ ...payload, permission: "plan" });
  assert.match((await pending).error, /outra conversa/);
  assert.equal(h.links.get(payload.sessionId).nativeId, "native-codex-123");
  runner.shutdown();
});
test("Codex cannot turn a nonzero exit into success and supports cancel while streaming", async () => {
  const h = harness();
  let runner = h.make(),
    pending = runner.execute(payload);
  await tick();
  h.notify("item/agentMessage/delta", { itemId: "a", delta: "incomplete" });
  h.calls[0].child.close(1);
  assert.equal((await pending).ok, false);
  runner = h.make();
  pending = runner.execute(payload);
  await tick();
  runner.kill(payload.sessionId);
  assert.equal((await pending).cancelled, true);
  runner.shutdown();
});
test("Codex keeps initial output that a CLI publishes only in its completed snapshot", async () => {
  const h = harness(),
    runner = h.make(),
    pending = runner.execute(payload);
  await tick();
  h.notify("item/commandExecution/outputDelta", {
    itemId: "cmd",
    delta: "last line\n",
  });
  h.notify("item/completed", {
    item: {
      id: "cmd",
      type: "commandExecution",
      aggregatedOutput: "first line\nlast line\n",
    },
  });
  const text = h.events
    .filter((e) => e.channel === "pty-data")
    .map((e) => e.data.data)
    .join("");
  assert.match(text, /first line/);
  assert.equal(text.split("last line").length - 1, 1);
  h.notify("turn/completed", { turn: { status: "completed" } });
  await pending;
  runner.shutdown();
});
