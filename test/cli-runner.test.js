const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { createCliRunner, buildArgs } = require("../electron/cli-runner");
function harness() {
  const links = new Map();
  const calls = [];
  const emitted = [];
  const store = {
    getNativeSession: async (id) => links.get(id),
    setNativeSession: async (id, provider, nativeId, cwd) =>
      links.set(id, { nativeId, cwd }),
  };
  const spawn = (bin, args, options) => {
    const child = new EventEmitter();
    child.pid = 100 + calls.length;
    child.exitCode = null;
    child.killed = false;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.inputs = [];
    child.stdin = new Writable({
      write(chunk, enc, done) {
        child.inputs.push(chunk.toString());
        done();
      },
    });
    child.event = (data) => child.stdout.write(JSON.stringify(data) + "\n");
    child.close = (code) => {
      child.exitCode = code;
      child.emit("close", code);
    };
    child.kill = () => {
      child.killed = true;
      queueMicrotask(() => child.close(143));
    };
    calls.push({ bin, args, options, child });
    return child;
  };
  const make = () =>
    createCliRunner({
      store,
      spawn,
      find: (n) => n,
      emit: (ch, data) => emitted.push({ ch, data }),
      checkCwd: (cwd) => cwd,
      turnTimeout: 1000,
    });
  return { make, calls, links, emitted, store };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const payload = (providerId) => ({
  sessionId: "app-session",
  providerId,
  prompt: "olá",
  cwd: "/workspace",
  permission: "plan",
  effort: "medium",
});
for (const provider of ["claude", "antigravity"]) {
  test(`${provider}: same native conversation across turns and runner restarts`, async () => {
    const h = harness();
    let runner = h.make();
    const first = runner.execute(payload(provider));
    await tick();
    const child = h.calls[0].child;
    child.event(
      provider === "codex"
        ? { type: "thread.started", thread_id: "native-id-123" }
        : { type: "system", session_id: "native-id-123" },
    );
    if (provider === "codex") {
      child.event({
        type: "item.completed",
        item: { type: "agent_message", text: "primeira" },
      });
      child.close(0);
    } else child.event({ type: "result", result: "primeira" });
    assert.equal((await first).ok, true);
    assert.equal(h.links.get("app-session").nativeId, "native-id-123");
    const second = runner.execute(payload(provider));
    await tick();
    const c = h.calls.at(-1).child;
    if (provider === "codex") {
      assert.ok(h.calls.at(-1).args.includes("resume"));
      c.event({
        type: "item.completed",
        item: { type: "agent_message", text: "segunda" },
      });
      c.close(0);
    } else {
      assert.equal(h.calls.length, 1);
      c.event({ type: "result", result: "segunda" });
    }
    assert.equal((await second).ok, true);
    runner.shutdown();
    await tick();
    runner = h.make();
    const third = runner.execute(payload(provider));
    await tick();
    const last = h.calls.at(-1);
    assert.ok(last.args.includes("native-id-123"));
    if (provider === "claude") {
      const context = last.args[last.args.indexOf("--append-system-prompt") + 1];
      assert.match(context, /preserve incremental stdout\/stderr/);
      assert.match(context, /unless the user explicitly requests/);
      assert.match(context, /does not grant permissions/);
      assert.equal(last.child.inputs.length, 1);
      assert.equal(JSON.parse(last.child.inputs[0]).message.content, "olá");
    } else assert.equal(last.args.includes("--append-system-prompt"), false);
    assert.ok(
      last.args.includes(
        provider === "claude"
          ? "--resume"
          : provider === "antigravity"
            ? "--conversation"
            : "resume",
      ),
    );
    if (provider === "codex") {
      last.child.event({
        type: "item.completed",
        item: { type: "agent_message", text: "terceira" },
      });
      last.child.close(0);
    } else last.child.event({ type: "result", result: "terceira" });
    assert.equal((await third).ok, true);
    runner.shutdown();
  });
  test(`${provider}: permission policy is forwarded for every level`, () => {
    for (const permission of ["plan", "ask", "edits", "full"]) {
      const args = buildArgs({ ...payload(provider), permission });
      if (provider === "codex")
        assert.ok(
          args.includes(
            `sandbox_mode="${["ask", "plan"].includes(permission) ? "read-only" : permission === "full" ? "danger-full-access" : "workspace-write"}"`,
          ),
        );
      else if (provider === "claude")
        assert.ok(
          args.includes(
            permission === "full"
              ? "--dangerously-skip-permissions"
              : ["ask", "plan"].includes(permission)
                ? "plan"
                : "acceptEdits",
          ),
        );
      else
        assert.ok(
          args.includes(
            ["ask", "plan"].includes(permission) ? "plan" : "accept-edits",
          ),
        );
    }
  });
}
test("concurrent turns and changing a resumed conversation's directory are rejected", async () => {
  const h = harness(),
    runner = h.make();
  const first = runner.execute(payload("claude"));
  await tick();
  assert.equal((await runner.execute(payload("claude"))).ok, false);
  h.calls[0].child.event({ type: "system", session_id: "native-id-123" });
  h.calls[0].child.event({ type: "result", result: "first" });
  assert.equal((await first).ok, true);
  assert.equal(
    (await runner.execute({ ...payload("claude"), cwd: "/other" })).ok,
    false,
  );
  runner.shutdown();
});
test("model/permission change resumes; changing native id is never silently accepted", async () => {
  const h = harness();
  const runner = h.make();
  let pending = runner.execute(payload("claude"));
  await tick();
  h.calls[0].child.event({ type: "system", session_id: "native-id-123" });
  h.calls[0].child.event({ type: "result", result: "ok" });
  await pending;
  pending = runner.execute({
    ...payload("claude"),
    permission: "full",
    model: "chosen-model",
  });
  await tick();
  assert.ok(h.calls[1].args.includes("native-id-123"));
  h.calls[1].child.event({ type: "system", session_id: "different-id-123" });
  assert.equal((await pending).ok, false);
  assert.equal(h.links.get("app-session").nativeId, "native-id-123");
  runner.shutdown();
});
test("UTF-8 chunks preserve characters; stdout without a session id cannot claim success", async () => {
  const h = harness();
  const runner = h.make();
  const pending = runner.execute(payload("claude"));
  await tick();
  const line = Buffer.from(
    JSON.stringify({ type: "result", result: "ação" }) + "\n",
  );
  const split = line.indexOf(Buffer.from("ç")) + 1;
  h.calls[0].child.stdout.write(line.subarray(0, split));
  h.calls[0].child.stdout.write(line.subarray(split));
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.output, "ação");
  runner.shutdown();
});
test("shutdown settles active turns", async () => {
  const h = harness();
  const runner = h.make();
  const pending = runner.execute(payload("antigravity"));
  await tick();
  runner.shutdown();
  assert.equal((await pending).ok, false);
});

test("AGY native event protocol streams, resumes and sends event:user instead of Claude input", async () => {
  const h = harness();
  const runner = h.make();
  const first = runner.execute(payload("antigravity"));
  await tick();
  const child = h.calls[0].child;
  const sent = JSON.parse(child.inputs[0]);
  assert.equal(sent.event, "user");
  assert.equal(sent.type, undefined);
  assert.equal(sent.message.content, "olá");
  assert.equal(h.calls[0].args.includes("-p"), false);
  child.event({
    event: "init",
    conversation_id: "agy-native-id-123",
    init: {},
  });
  child.event({
    event: "step_update",
    step_update: {
      conversation_id: "agy-native-id-123",
      step_index: 1,
      state: "ACTIVE",
      step_type: "agent_response",
      text_delta: "Olá ",
    },
  });
  child.event({
    event: "step_update",
    step_update: {
      conversation_id: "agy-native-id-123",
      step_index: 1,
      state: "DONE",
      step_type: "agent_response",
      text_delta: "mundo",
    },
  });
  child.event({
    event: "step_update",
    step_update: {
      step_index: 2,
      step_type: "tool",
      state: "ACTIVE",
      tool_info: { parameters: { CommandLine: "echo fixture" } },
    },
  });
  child.event({
    event: "step_update",
    step_update: {
      step_index: 2,
      step_type: "tool",
      state: "DONE",
      tool_info: {
        parameters: { CommandLine: "echo fixture" },
        output: "fixture",
      },
    },
  });
  child.event({
    event: "result",
    result: {
      conversation_id: "agy-native-id-123",
      status: "SUCCESS",
      response: "Olá mundo",
    },
  });
  const result = await first;
  assert.equal(result.ok, true);
  assert.equal(result.output, "Olá mundo");
  assert.equal(result.nativeSessionId, "agy-native-id-123");
  assert.ok(
    h.emitted.some(
      (e) => e.ch === "cli-stream-chunk" && e.data.fullText === "Olá mundo",
    ),
  );
  assert.ok(
    h.emitted.some(
      (e) => e.ch === "pty-data" && e.data.data.includes("echo fixture"),
    ),
  );
  const second = runner.execute(payload("antigravity"));
  await tick();
  assert.equal(h.calls.length, 1);
  child.event({
    event: "result",
    result: {
      conversation_id: "agy-native-id-123",
      status: "PERMISSION_DENIED",
      error: "Denied by CLI",
    },
  });
  const failed = await second;
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "Denied by CLI");
  runner.shutdown();
});
test("live AGY output snapshots and stderr reach the shell before completion, with response ids", async () => {
  const h = harness(),
    runner = h.make();
  const pending = runner.execute({
    ...payload("antigravity"),
    responseMessageId: "response-live",
  });
  await tick();
  const c = h.calls[0].child;
  c.event({ event: "init", conversation_id: "native-live-123" });
  const tool = (state, output) =>
    c.event({
      event: "step_update",
      step_update: {
        step_index: 2,
        step_type: "tool",
        state,
        tool_info: { parameters: { CommandLine: "npm test" }, output },
      },
    });
  tool("ACTIVE", "first\n");
  tool("ACTIVE", "first\nsecond\n");
  tool("DONE", "first\nsecond\n");
  c.stderr.write("progress live\n");
  const data = h.emitted
    .filter((e) => e.ch === "pty-data")
    .map((e) => e.data.data)
    .join("");
  assert.equal((data.match(/first/g) || []).length, 1);
  assert.equal((data.match(/second/g) || []).length, 1);
  assert.match(data, /progress live/);
  assert.equal(runner.isBusy("app-session"), true);
  c.event({
    event: "step_update",
    step_update: { step_type: "agent_response", text_delta: "reply" },
  });
  assert.equal(
    h.emitted.find((e) => e.ch === "cli-stream-chunk").data.responseMessageId,
    "response-live",
  );
  c.event({
    event: "result",
    result: { status: "SUCCESS", response: "reply" },
  });
  assert.equal((await pending).ok, true);
  runner.shutdown();
});
