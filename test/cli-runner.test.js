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
  const make = (extra = {}) =>
    createCliRunner({
      ...extra,
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
test("Claude emits a live timeline: thinking, tool call with result, compaction, and returns it with the turn", async () => {
  const h = harness();
  const runner = h.make();
  const pending = runner.execute({ ...payload("claude"), responseMessageId: "resp-1" });
  await tick();
  const child = h.calls[0].child;
  child.event({ type: "system", subtype: "init", session_id: "claude-native-123" });
  child.event({
    type: "stream_event",
    event: { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
  });
  child.event({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Preciso ler o arquivo" } },
  });
  await tick();
  let timeline = h.emitted.filter((e) => e.ch === "cli-activity-event").map((e) => e.data.event);
  const thinking = timeline.filter((e) => e.kind === "reasoning").at(-1);
  assert.equal(thinking.status, "running");
  assert.match(thinking.text, /Preciso ler/);
  assert.equal(h.emitted.find((e) => e.ch === "cli-activity-event").data.responseMessageId, "resp-1");
  child.event({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
  child.event({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "npm test" } }] },
  });
  child.event({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok", is_error: false }] },
  });
  child.event({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto" } });
  child.event({ type: "result", session_id: "claude-native-123", result: "pronto", is_error: false });
  child.close(0);
  const result = await pending;
  const byKind = Object.fromEntries(result.events.map((e) => [e.kind, e]));
  assert.equal(byKind.reasoning.status, "done");
  assert.equal(byKind.command.title, "Bash");
  assert.equal(byKind.command.detail, "npm test");
  assert.equal(byKind.command.status, "done");
  assert.equal(byKind.compaction.status, "done");
  assert.ok(result.events.every((e) => e.status !== "running"));
});

test("AGY steps become timeline events and failed tools are marked as errors", async () => {
  const h = harness();
  const runner = h.make();
  const pending = runner.execute({ ...payload("antigravity"), responseMessageId: "resp-agy" });
  await tick();
  const child = h.calls[0].child;
  child.event({ event: "init", conversation_id: "agy-native-id-123", init: {} });
  child.event({
    event: "step_update",
    step_update: { step_index: 4, step_type: "tool", state: "ACTIVE", tool_info: { name: "run_command", parameters: { CommandLine: "make" } } },
  });
  child.event({
    event: "step_update",
    step_update: { step_index: 4, step_type: "tool", state: "DONE", tool_info: { name: "run_command", parameters: { CommandLine: "make" }, error: { message: "falhou" } } },
  });
  child.event({
    event: "step_update",
    step_update: { step_index: 5, step_type: "planning", state: "ACTIVE" },
  });
  child.event({ event: "result", result: { conversation_id: "agy-native-id-123", status: "SUCCESS", response: "fim" } });
  const result = await pending;
  const tool = result.events.find((e) => e.id === "step-4");
  assert.equal(tool.kind, "command");
  assert.equal(tool.status, "error");
  assert.equal(tool.detail, "falhou");
  const generic = result.events.find((e) => e.id === "step-5");
  assert.equal(generic.title, "planning");
  assert.equal(generic.status, "done");
});

test("Claude: a escolha 'permitir nesta sessão' volta à CLI como updatedPermissions; negar leva a instrução", async () => {
  const request = {
    subtype: "can_use_tool", tool_name: "Bash", display_name: "Bash",
    input: { command: "touch /tmp/x" },
    permission_suggestions: [
      { type: "addDirectories", directories: ["/tmp"], destination: "session" },
    ],
  };
  const asked = [];
  const decisions = [{ allow: true, optionId: "suggest-0", native: { updatedPermissions: [request.permission_suggestions[0]] } }, { allow: false, optionId: "deny", message: "use /workspace" }];
  const approvals = {
    askDetailed: async (req) => (asked.push(req), decisions.shift()),
    cancelSession() {}, shutdown() {},
  };
  const calls = [];
  const spawn = (bin, args, options) => {
    const child = new EventEmitter();
    Object.assign(child, { pid: 900, exitCode: null, killed: false, stdout: new PassThrough(), stderr: new PassThrough(), inputs: [] });
    child.stdin = new Writable({ write(chunk, enc, done) { child.inputs.push(chunk.toString()); done(); } });
    child.event = (d) => child.stdout.write(JSON.stringify(d) + "\n");
    child.close = (code) => { child.exitCode = code; child.emit("close", code); };
    child.kill = () => { child.killed = true; queueMicrotask(() => child.close(143)); };
    calls.push({ bin, args, child });
    return child;
  };
  const links = new Map();
  const r2 = createCliRunner({
    store: { getNativeSession: async (id) => links.get(id), setNativeSession: async (id, p, n, c) => links.set(id, { nativeId: n, cwd: c }) },
    spawn, find: (n) => n, emit: () => {}, checkCwd: (c) => c, approvals,
  });
  const pending = r2.execute({ ...payload("claude"), permission: "edits" });
  await tick();
  const child = calls[0].child;
  child.event({ type: "system", subtype: "init", session_id: "claude-native-777" });
  child.event({ type: "control_request", request_id: "req-1", request });
  await tick();
  child.event({ type: "control_request", request_id: "req-2", request });
  await tick();
  assert.deepEqual(asked[0].options.map((o) => o.id), ["allow", "suggest-0", "deny"]);
  assert.equal(asked[0].tool, "Bash");
  const responses = child.inputs.map((s) => JSON.parse(s)).filter((m) => m.type === "control_response");
  assert.equal(responses[0].response.request_id, "req-1");
  assert.equal(responses[0].response.response.behavior, "allow");
  assert.deepEqual(responses[0].response.response.updatedPermissions, [request.permission_suggestions[0]]);
  assert.deepEqual(responses[0].response.response.updatedInput, request.input);
  assert.equal(responses[1].response.response.behavior, "deny");
  assert.equal(responses[1].response.response.message, "use /workspace");
  child.event({ type: "result", session_id: "claude-native-777", result: "ok", is_error: false });
  child.close(0);
  await pending;
});

test("Claude: thinking_tokens (texto do raciocínio vem vazio) vira progresso visível na etapa", async () => {
  const h = harness();
  const runner = h.make();
  const pending = runner.execute({ ...payload("claude"), responseMessageId: "resp-think" });
  await tick();
  const child = h.calls[0].child;
  child.event({ type: "system", subtype: "init", session_id: "claude-native-123" });
  child.event({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } } });
  child.event({ type: "system", subtype: "thinking_tokens", estimated_tokens: 50, estimated_tokens_delta: 50 });
  child.event({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "", estimated_tokens: 50 } } });
  child.event({ type: "system", subtype: "thinking_tokens", estimated_tokens: 189, estimated_tokens_delta: 139 });
  await tick();
  const live = h.emitted.filter((e) => e.ch === "cli-activity-event").map((e) => e.data.event).filter((e) => e.kind === "reasoning");
  assert.equal(live.at(-1).detail, "~189 tokens de raciocínio");
  assert.equal(live.at(-1).status, "running");
  assert.ok(h.emitted.some((e) => e.ch === "cli-stream-chunk" && e.data.detail === "~189 tokens de raciocínio"));
  child.event({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
  child.event({ type: "result", session_id: "claude-native-123", result: "ok", is_error: false });
  child.close(0);
  const result = await pending;
  const thinking = result.events.find((e) => e.kind === "reasoning");
  assert.equal(thinking.status, "done");
  assert.equal(thinking.detail, "~189 tokens de raciocínio");
});

test("Claude: contexto ao vivo pelo usage, janela real pelo result e compactação com antes/depois", async () => {
  const h = harness();
  const runner = h.make();
  const pending = runner.execute({ ...payload("claude"), responseMessageId: "resp-ctx" });
  await tick();
  const child = h.calls[0].child;
  const contexts = () => h.emitted.filter((e) => e.ch === "cli-context").map((e) => e.data);
  child.event({ type: "system", subtype: "init", session_id: "claude-native-123" });
  child.event({ type: "assistant", message: { model: "claude-haiku-5-5", usage: { input_tokens: 2, cache_creation_input_tokens: 6390, cache_read_input_tokens: 9014, output_tokens: 4 }, content: [{ type: "text", text: "ok" }] } });
  await tick();
  assert.equal(contexts().at(-1).used, 15406);
  assert.equal(contexts().at(-1).windowKnown, false, "janela ainda estimada");
  // subagente (sidechain) não conta como contexto da conversa principal
  child.event({ type: "assistant", parent_tool_use_id: "tool-9", message: { model: "claude-haiku-5-5", usage: { input_tokens: 999999 }, content: [] } });
  await tick();
  assert.equal(contexts().at(-1).used, 15406);
  child.event({ type: "system", subtype: "status", status: "compacting" });
  await tick();
  assert.equal(contexts().at(-1).compacting, true);
  child.event({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 15522, post_tokens: 3451 } });
  await tick();
  assert.equal(contexts().at(-1).compacting, false);
  assert.equal(contexts().at(-1).used, 3451);
  child.event({ type: "result", session_id: "claude-native-123", result: "ok", is_error: false, modelUsage: { "claude-haiku-5-5": { contextWindow: 1000000 } } });
  child.close(0);
  const result = await pending;
  assert.equal(result.context.window, 1000000);
  assert.equal(result.context.windowKnown, true);
  assert.equal(result.context.used, 3451);
  assert.equal(result.context.lastCompaction.pre, 15522);
});

// Eventos capturados do AGY 1.4.12 real: tipos de etapa, tool_info e usage por chamada.
test("AGY real: etapas de pedido e prompt de sistema não viram eventos; ferramenta e uso por chamada sim", async () => {
  const h = harness();
  const runner = h.make();
  const pending = runner.execute({ ...payload("antigravity"), responseMessageId: "resp-agy-real" });
  await tick();
  const child = h.calls[0].child;
  const cid = "a0d210fc-b917-4070-8e47-48002703187f";
  child.event({ event: "init", conversation_id: cid, init: { cwd: "/tmp", tools: [] } });
  child.event({ event: "step_update", step_update: { conversation_id: cid, step_index: 0, state: "DONE", step_type: "user_input" } });
  child.event({ event: "step_update", step_update: { conversation_id: cid, step_index: 1, state: "DONE", step_type: "system_message", duration_seconds: 0.003 } });
  child.event({ event: "step_update", step_update: { conversation_id: cid, step_index: 5, state: "ACTIVE", step_type: "tool", tool_name: "run_command", tool_info: { name: "run_command", parameters: { CommandLine: "ls -A /tmp | wc -l" } } } });
  child.event({ event: "step_update", step_update: { conversation_id: cid, step_index: 5, state: "DONE", step_type: "tool", tool_name: "run_command", duration_seconds: 0.58, tool_info: { name: "run_command", parameters: { CommandLine: "ls -A /tmp | wc -l" }, output: "Command exited with code 0." } } });
  child.event({ event: "step_update", step_update: { conversation_id: cid, step_index: 6, state: "DONE", step_type: "agent_response", text_delta: "\n", duration_seconds: 1.38, usage: { input_tokens: 16572, output_tokens: 4, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 16576 } } });
  child.event({ event: "result", result: { conversation_id: cid, status: "SUCCESS", response: "ok\n", num_turns: 1, usage: { input_tokens: 16572, output_tokens: 4, total_tokens: 16576 } } });
  const result = await pending;
  assert.deepEqual(result.events.map((e) => e.id), ["step-5"], "só a ferramenta aparece");
  assert.equal(result.events[0].title, "run_command");
  assert.equal(result.events[0].kind, "command");
  assert.equal(result.events[0].detail, "ls -A /tmp | wc -l");
  assert.equal(result.events[0].status, "done");
  assert.equal(result.context.used, 16572);
  assert.equal(result.context.window, null, "o AGY não informa a janela do modelo");
  assert.equal(result.context.source, "antigravity");
});

test("Claude: comando Bash em segundo plano (task local_bash) continua comando e não conta como agente", async () => {
  const h = harness();
  const runner = h.make();
  const pending = runner.execute({ ...payload("claude"), responseMessageId: "resp-bash-task" });
  await tick();
  const child = h.calls[0].child;
  const BASH = "toolu_bash_bg_1";
  child.event({ type: "system", subtype: "init", session_id: "claude-native-123" });
  child.event({ type: "assistant", message: { model: "claude-sonnet-5-5", content: [{ type: "tool_use", id: BASH, name: "Bash", input: { command: "sleep 5", description: "Block until test process exits", run_in_background: true } }] } });
  child.event({ type: "system", subtype: "task_started", task_id: "b1", tool_use_id: BASH, description: "Block until test process exits", task_type: "local_bash" });
  child.event({ type: "result", session_id: "claude-native-123", result: "ok", is_error: false });
  child.close(0);
  const result = await pending;
  const ev = result.events.find((e) => e.id === BASH);
  assert.equal(ev.kind, "command");
  assert.equal(result.events.filter((e) => e.kind === "agent").length, 0);
});

// Sequência capturada do Claude Code 2.1.316 real: ferramenta `Agent`, ciclo task_* e etapas internas.
test("Claude real: o subagente vira uma etapa de agente com as etapas internas aninhadas e o resumo final", async () => {
  const h = harness();
  const runner = h.make();
  const pending = runner.execute({ ...payload("claude"), responseMessageId: "resp-agent" });
  await tick();
  const child = h.calls[0].child;
  const AGENT = "toolu_01L132EM4viNtb5ahQvPqp6r";
  const SUB_TOOL = "toolu_012cWrYxK6g768vvxfAjrSe6";
  child.event({ type: "system", subtype: "init", session_id: "claude-native-123" });
  child.event({ type: "assistant", message: { model: "claude-sonnet-5-5", content: [{ type: "tool_use", id: AGENT, name: "Agent", input: { description: "Contar arquivos em /tmp", subagent_type: "general-purpose", prompt: "Count files" } }] } });
  child.event({ type: "system", subtype: "task_started", task_id: "a4e496bba94b5f9c8", tool_use_id: AGENT, description: "Contar arquivos em /tmp", subagent_type: "general-purpose", task_type: "local_agent", spawn_depth: 1 });
  child.event({ type: "assistant", parent_tool_use_id: AGENT, agent_id: "a4e496bba94b5f9c8", message: { model: "claude-sonnet-5-5", usage: { input_tokens: 999999 }, content: [{ type: "tool_use", id: SUB_TOOL, name: "Bash", input: { command: "find /tmp -type f | wc -l" } }] } });
  child.event({ type: "system", subtype: "task_progress", task_id: "a4e496bba94b5f9c8", tool_use_id: AGENT, description: "Running find /tmp -type f | wc -l", usage: { total_tokens: 11833, tool_uses: 1, duration_ms: 2504 }, last_tool_name: "Bash" });
  await tick();
  const live = h.emitted.filter((e) => e.ch === "cli-activity-event").map((e) => e.data.event);
  assert.equal(live.filter((e) => e.id === AGENT).at(-1).meta.lastTool, "Bash");
  child.event({ type: "user", parent_tool_use_id: AGENT, message: { content: [{ tool_use_id: SUB_TOOL, type: "tool_result", content: "69637", is_error: false }] } });
  child.event({ type: "system", subtype: "task_updated", task_id: "a4e496bba94b5f9c8", patch: { status: "completed" } });
  child.event({ type: "system", subtype: "task_notification", task_id: "a4e496bba94b5f9c8", tool_use_id: AGENT, status: "completed", summary: "69637", usage: { total_tokens: 13780, tool_uses: 1, duration_ms: 4434 } });
  child.event({ type: "user", message: { content: [{ tool_use_id: AGENT, type: "tool_result", content: [{ type: "text", text: "69637" }] }] } });
  child.event({ type: "result", session_id: "claude-native-123", result: "69637", is_error: false });
  child.close(0);
  const result = await pending;
  const agent = result.events.find((e) => e.id === AGENT);
  assert.equal(agent.kind, "agent");
  assert.equal(agent.title, "Agente general-purpose");
  assert.equal(agent.status, "done");
  assert.equal(agent.text, "69637");
  assert.deepEqual({ tokens: agent.meta.tokens, toolUses: agent.meta.toolUses, subagentType: agent.meta.subagentType, taskId: agent.meta.taskId }, { tokens: 13780, toolUses: 1, subagentType: "general-purpose", taskId: "a4e496bba94b5f9c8" });
  const inner = result.events.find((e) => e.id === SUB_TOOL);
  assert.equal(inner.parentId, AGENT);
  assert.equal(inner.kind, "command");
  assert.equal(inner.status, "done");
  assert.ok(result.events.every((e) => e.status !== "running"));
  // a chamada do subagente não conta como contexto da conversa principal
  assert.ok(!h.emitted.some((e) => e.ch === "cli-context" && e.data.used === 999999));
});

test("AGY: ferramenta de subagente é classificada como agente", async () => {
  const h = harness();
  const runner = h.make();
  const pending = runner.execute({ ...payload("antigravity"), responseMessageId: "resp-agy-agent" });
  await tick();
  const child = h.calls[0].child;
  child.event({ event: "init", conversation_id: "agy-native-id-123", init: {} });
  child.event({ event: "step_update", step_update: { step_index: 3, step_type: "tool", state: "ACTIVE", tool_name: "browser_subagent", tool_info: { name: "browser_subagent", parameters: { Task: "abrir a página" } } } });
  child.event({ event: "step_update", step_update: { step_index: 3, step_type: "tool", state: "DONE", tool_name: "browser_subagent", tool_info: { name: "browser_subagent", parameters: { Task: "abrir a página" }, output: "ok" } } });
  child.event({ event: "result", result: { conversation_id: "agy-native-id-123", status: "SUCCESS", response: "fim" } });
  const result = await pending;
  assert.equal(result.events[0].kind, "agent");
  assert.equal(result.events[0].title, "browser_subagent");
});

test("comando que guarda a saída até o fim (| tail) recebe aviso na etapa, nas três CLIs", async () => {
  const { bufferingNote } = require("../electron/activity-labels");
  assert.match(bufferingNote("npm test 2>&1 | tail -40"), /\| tail/);
  assert.match(bufferingNote("cat x | sort | head -3"), /\| sort|\| head/);
  assert.equal(bufferingNote("npm test"), null);
  assert.equal(bufferingNote("grep a b | less"), null);
  // Claude
  const h = harness();
  const runner = h.make();
  const pending = runner.execute({ ...payload("claude"), responseMessageId: "r-note" });
  await tick();
  const child = h.calls[0].child;
  child.event({ type: "system", subtype: "init", session_id: "claude-native-123" });
  child.event({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test 2>&1 | tail -40" } }] } });
  child.event({ type: "result", session_id: "claude-native-123", result: "ok", is_error: false });
  child.close(0);
  const claude = await pending;
  assert.match(claude.events.find((e) => e.id === "t1").meta.note, /tail/);
  // AGY
  const h2 = harness();
  const r2 = h2.make();
  const p2 = r2.execute({ ...payload("antigravity"), responseMessageId: "r-note2" });
  await tick();
  const c2 = h2.calls[0].child;
  c2.event({ event: "init", conversation_id: "agy-native-id-123", init: {} });
  c2.event({ event: "step_update", step_update: { step_index: 5, step_type: "tool", state: "ACTIVE", tool_name: "run_command", tool_info: { name: "run_command", parameters: { CommandLine: "npm test 2>&1 | tail -40" } } } });
  c2.event({ event: "result", result: { conversation_id: "agy-native-id-123", status: "SUCCESS", response: "ok" } });
  assert.match((await p2).events.find((e) => e.id === "step-5").meta.note, /tail/);
});

// O cenário de um agente lançado em segundo plano (run_in_background): a chamada volta na hora e o
// agente trabalha depois do fim do turno. Sequência no formato real do Claude Code 2.1.316.
test("Claude: agente em segundo plano segue 'rodando' após o turno e as atualizações tardias chegam à resposta de origem", async () => {
  const h = harness();
  const late = [];
  const runner = h.make({ onLateEvents: (p) => late.push(p) });
  const pending = runner.execute({ ...payload("claude"), responseMessageId: "resp-bg" });
  await tick();
  const child = h.calls[0].child;
  const AGENT = "toolu_bg_agent_1";
  child.event({ type: "system", subtype: "init", session_id: "claude-native-123" });
  child.event({ type: "assistant", message: { model: "claude-sonnet-5-5", content: [{ type: "tool_use", id: AGENT, name: "Agent", input: { description: "Rodar testes unitários", subagent_type: "general-purpose", prompt: "npm test", run_in_background: true } }] } });
  child.event({ type: "user", message: { content: [{ tool_use_id: AGENT, type: "tool_result", content: "Async agent launched successfully. The agent is working in the background." }] } });
  child.event({ type: "result", session_id: "claude-native-123", result: "Disparei um agente.", is_error: false });
  child.close(0);
  const result = await pending;
  const atEnd = result.events.find((e) => e.id === AGENT);
  assert.equal(atEnd.kind, "agent");
  assert.equal(atEnd.status, "running", "o retorno imediato da chamada não encerra o agente");
  assert.equal(atEnd.meta.background, true);
  // ...e o agente trabalha depois do fim do turno: os eventos continuam chegando.
  const emitted = () => h.emitted.filter((e) => e.ch === "cli-activity-event").map((e) => e.data);
  child.exitCode = null; // o processo segue vivo para o agente
  child.event({ type: "system", subtype: "task_started", task_id: "tk1", tool_use_id: AGENT, subagent_type: "general-purpose", description: "Rodar testes unitários", is_backgrounded: true });
  child.event({ type: "assistant", parent_tool_use_id: AGENT, message: { model: "claude-sonnet-5-5", content: [{ type: "tool_use", id: "inner-1", name: "Bash", input: { command: "timeout 600 npm test 2>&1 | tail -n 400" } }] } });
  child.event({ type: "system", subtype: "task_progress", task_id: "tk1", tool_use_id: AGENT, description: "Running npm test", usage: { total_tokens: 900, tool_uses: 1, duration_ms: 3000 }, last_tool_name: "Bash" });
  child.event({ type: "user", parent_tool_use_id: AGENT, message: { content: [{ tool_use_id: "inner-1", type: "tool_result", content: "789 passed", is_error: false }] } });
  child.event({ type: "system", subtype: "task_notification", task_id: "tk1", tool_use_id: AGENT, status: "completed", summary: "Todos os testes passaram", usage: { total_tokens: 4000, tool_uses: 1, duration_ms: 60000 } });
  await tick();
  const toOrigin = emitted().filter((d) => d.responseMessageId === "resp-bg");
  const finalAgent = toOrigin.filter((d) => d.event.id === AGENT).at(-1).event;
  assert.equal(finalAgent.status, "done");
  assert.equal(finalAgent.text, "Todos os testes passaram");
  assert.equal(finalAgent.meta.tokens, 4000);
  const inner = toOrigin.filter((d) => d.event.id === "inner-1").at(-1).event;
  assert.equal(inner.parentId, AGENT);
  assert.equal(inner.status, "done");
  assert.match(inner.meta.note, /tail/, "o aviso do | tail também vale para o agente");
  // A gravação tardia (com atraso) recebe a resposta de origem com o estado final.
  await new Promise((r) => setTimeout(r, 500));
  const saved = late.filter((p) => p.responseMessageId === "resp-bg").at(-1);
  assert.equal(saved.events.find((e) => e.id === AGENT).status, "done");
  assert.ok(saved.events.some((e) => e.id === "inner-1"));
});

// O agente principal recebe o resultado do agente em segundo plano e responde sozinho (turno
// espontâneo). Sequência no formato real do Claude Code: nenhuma mensagem do usuário em andamento.
const until = async (check, ms = 1500) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("condição não atingida: " + check);
    await new Promise((r) => setTimeout(r, 5));
  }
};
test("Claude: o turno que a CLI começa sozinha vira uma mensagem nova (ao vivo, gravada e avisada)", async () => {
  const h = harness();
  const autos = [];
  const runner = h.make({ onAutoTurn: (p) => autos.push(p) });
  const pending = runner.execute({ ...payload("claude"), responseMessageId: "resp-user" });
  await tick();
  const child = h.calls[0].child;
  const AGENT = "toolu_bg_2";
  child.event({ type: "system", subtype: "init", session_id: "claude-native-123" });
  child.event({ type: "assistant", message: { model: "claude-sonnet-5-5", content: [{ type: "tool_use", id: AGENT, name: "Agent", input: { description: "d", subagent_type: "general-purpose", prompt: "p", run_in_background: true } }] } });
  child.event({ type: "user", message: { content: [{ tool_use_id: AGENT, type: "tool_result", content: "Async agent launched" }] } });
  child.event({ type: "assistant", message: { model: "claude-sonnet-5-5", content: [{ type: "text", text: "Mandei um agente. Aviso quando terminar." }] } });
  child.event({ type: "result", session_id: "claude-native-123", result: "Mandei um agente. Aviso quando terminar.", is_error: false });
  const first = await pending;
  assert.equal(first.output, "Mandei um agente. Aviso quando terminar.");
  assert.equal(autos.length, 0, "o turno pedido por você não é espontâneo");

  // Etapas internas de um subagente (parent_tool_use_id) NÃO começam turno.
  child.event({ type: "assistant", parent_tool_use_id: AGENT, message: { model: "claude-sonnet-5-5", content: [{ type: "tool_use", id: "in1", name: "Bash", input: { command: "ls" } }] } });
  child.event({ type: "system", subtype: "task_notification", tool_use_id: AGENT, status: "completed", summary: "789 passaram" });
  await tick();
  assert.equal(h.emitted.filter((e) => e.ch === "cli-turn-started").length, 0);

  // O agente principal recebe o resultado e responde sozinho.
  child.event({ type: "stream_event", event: { type: "message_start", message: { model: "claude-sonnet-5-5" } } });
  child.event({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Os testes " } } });
  child.event({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "passaram: 789." } } });
  await tick();
  const started = h.emitted.filter((e) => e.ch === "cli-turn-started");
  assert.equal(started.length, 1);
  const id = started[0].data.responseMessageId;
  assert.match(id, /^auto-/);
  assert.equal(started[0].data.providerId, "claude");
  const chunks = h.emitted.filter((e) => e.ch === "cli-stream-chunk" && e.data.responseMessageId === id);
  assert.equal(chunks.at(-1).data.fullText, "Os testes passaram: 789.", "o texto chega ao vivo");
  assert.equal(autos.length, 0, "ainda em andamento");
  child.event({ type: "assistant", message: { model: "claude-sonnet-5-5", usage: { input_tokens: 10, cache_read_input_tokens: 500 }, content: [{ type: "text", text: "Os testes passaram: 789." }] } });
  child.event({ type: "result", session_id: "claude-native-123", result: "Os testes passaram: 789.", is_error: false });
  await until(() => autos.length === 1);
  const finished = h.emitted.filter((e) => e.ch === "cli-turn-finished");
  assert.equal(finished.length, 1);
  assert.equal(finished[0].data.text, "Os testes passaram: 789.");
  assert.equal(finished[0].data.ok, true);
  assert.equal(finished[0].data.discard, false);
  assert.equal(autos.length, 1, "o app foi avisado para gravar e notificar");
  assert.equal(autos[0].responseMessageId, id);
  assert.equal(autos[0].context.used, 510);
});

test("Claude: turno espontâneo sem texto é descartado e uma mensagem sua espera um turno espontâneo em andamento", async () => {
  const h = harness();
  const autos = [];
  const runner = h.make({ onAutoTurn: (p) => autos.push(p) });
  const p1 = runner.execute({ ...payload("claude"), responseMessageId: "r1" });
  await tick();
  const child = h.calls[0].child;
  child.event({ type: "system", subtype: "init", session_id: "claude-native-123" });
  child.event({ type: "result", session_id: "claude-native-123", result: "ok", is_error: false });
  await p1;
  // turno espontâneo só com ferramenta, sem texto
  child.event({ type: "stream_event", event: { type: "message_start", message: {} } });
  child.event({ type: "result", session_id: "claude-native-123", result: "", is_error: false });
  await until(() => autos.length === 1);
  assert.equal(autos.at(-1).discard, true);
  // nova mensagem sua com um turno espontâneo em andamento: espera terminar
  child.event({ type: "stream_event", event: { type: "message_start", message: {} } });
  child.event({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "resposta espontânea" } } });
  await tick();
  let second = false;
  const p2 = runner.execute({ ...payload("claude"), prompt: "outra", responseMessageId: "r2" }).then((r) => ((second = true), r));
  await tick();
  assert.equal(child.inputs.length, 1, "a mensagem nova ainda não foi enviada à CLI");
  assert.equal(second, false);
  child.event({ type: "result", session_id: "claude-native-123", result: "resposta espontânea", is_error: false });
  await until(() => child.inputs.length === 2);
  assert.equal(child.inputs.length, 2, "agora foi");
  child.event({ type: "assistant", message: { content: [{ type: "text", text: "resposta à outra" }] } });
  child.event({ type: "result", session_id: "claude-native-123", result: "resposta à outra", is_error: false });
  assert.equal((await p2).output, "resposta à outra");
});

test("AGY: step_type subagent registra o filho, mantém o agente ativo durante o trabalho e aninha comandos do transcript", async (t) => {
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-agy-subagent-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const oldHome = process.env.GEMINI_CLI_HOME;
  process.env.GEMINI_CLI_HOME = path.join(home, ".gemini");
  t.after(() => {
    if (oldHome === undefined) delete process.env.GEMINI_CLI_HOME;
    else process.env.GEMINI_CLI_HOME = oldHome;
  });
  const childId = "child-subagent-999";
  const logsDir = path.join(
    process.env.GEMINI_CLI_HOME,
    "antigravity-cli",
    "brain",
    childId,
    ".system_generated",
    "logs",
  );
  fs.mkdirSync(logsDir, { recursive: true });
  const transcript = path.join(logsDir, "transcript.jsonl");
  fs.writeFileSync(
    transcript,
    JSON.stringify({
      step_index: 2,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      tool_calls: [{ name: "run_command", args: { CommandLine: JSON.stringify("npm test") } }],
    }) + "\n",
  );
  const h = harness();
  const runner = h.make();
  const pending = runner.execute({ ...payload("antigravity"), responseMessageId: "resp-sub" });
  await tick();
  const child = h.calls[0].child;
  child.event({ event: "init", conversation_id: "agy-parent-123", init: {} });
  child.event({
    event: "step_update",
    step_update: {
      conversation_id: "agy-parent-123",
      step_index: 3,
      state: "ACTIVE",
      step_type: "tool",
      tool_name: "invoke_subagent",
      tool_info: { name: "invoke_subagent", parameters: { Role: "Test Runner", TypeName: "self" } },
    },
  });
  child.event({
    event: "step_update",
    step_update: {
      conversation_id: "agy-parent-123",
      step_index: 3,
      state: "DONE",
      step_type: "subagent",
      tool_name: "invoke_subagent",
      subagent_info: {
        subagents: [
          {
            type_name: "self",
            role: "Test Runner",
            initial_prompt: "Execute npm test",
            conversation_id: childId,
          },
        ],
      },
    },
  });
  await new Promise((r) => setTimeout(r, 220));
  const liveAgent = h.emitted
    .filter((e) => e.ch === "cli-activity-event" && e.data.event.id === "step-3")
    .map((e) => e.data.event)
    .at(-1);
  assert.equal(liveAgent.kind, "agent");
  assert.equal(liveAgent.status, "running", "continua ativo enquanto o subagente trabalha");
  assert.equal(liveAgent.detail, "Execute npm test");
  fs.appendFileSync(
    transcript,
    JSON.stringify({
      step_index: 3,
      type: "GENERIC",
      status: "DONE",
      content: "Created At: now\nCommand output:\nSUBAGENT_TEST_OK\n",
    }) +
      "\n" +
      JSON.stringify({
        step_index: 4,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        content: "Testes concluídos.",
      }) +
      "\n",
  );
  child.event({
    event: "result",
    result: { conversation_id: "agy-parent-123", status: "SUCCESS", response: "Pronto" },
  });
  const result = await pending;
  assert.equal(result.ok, true);
  const agentEvent = result.events.find((e) => e.id === "step-3");
  const cmdEvent = result.events.find((e) => e.kind === "command" && e.parentId === "step-3");
  assert.equal(agentEvent.status, "done");
  assert.ok(cmdEvent, "comando do subagente fica aninhado no agente pai");
  assert.equal(cmdEvent.detail, "npm test");
  assert.equal(cmdEvent.status, "done");
  runner.shutdown();
});

test("Claude: comandos em paralelo chegam ao shell etiquetados com o id da ferramenta (shellId)", async () => {
  const h = harness(), runner = h.make();
  const pending = runner.execute({ ...payload("claude"), responseMessageId: "resp-sh" });
  await tick();
  const child = h.calls[0].child;
  child.event({ type: "system", subtype: "init", session_id: "claude-native-sh" });
  child.event({
    type: "assistant",
    message: { content: [
      { type: "tool_use", id: "tool-a", name: "Bash", input: { command: "npm test" } },
      { type: "tool_use", id: "tool-b", name: "Bash", input: { command: "npm run build" } },
    ] },
  });
  child.event({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-b", content: "built", is_error: false }] } });
  child.event({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-a", content: "tested", is_error: false }] } });
  child.event({ type: "result", session_id: "claude-native-sh", result: "pronto", is_error: false });
  child.close(0);
  await pending;
  const chunks = h.emitted.filter((e) => e.ch === "pty-data").map((e) => e.data);
  const of = (id) => chunks.filter((d) => d.shellId === id).map((d) => d.data).join("");
  assert.match(of("tool-a"), /\$ npm test[\s\S]*tested/);
  assert.match(of("tool-b"), /\$ npm run build[\s\S]*built/);
  assert.doesNotMatch(of("tool-a"), /built/);
});

test("AGY: o passo da ferramenta é a origem da saída no shell (shellId)", async () => {
  const h = harness(), runner = h.make();
  const pending = runner.execute({ ...payload("antigravity"), responseMessageId: "response-sh" });
  await tick();
  const c = h.calls[0].child;
  c.event({ event: "init", conversation_id: "native-sh-1" });
  const tool = (index, command, state, output) =>
    c.event({ event: "step_update", step_update: { step_index: index, step_type: "tool", state, tool_info: { parameters: { CommandLine: command }, output } } });
  tool(2, "npm test", "ACTIVE", "testing\n");
  tool(3, "npm run build", "ACTIVE", "building\n");
  tool(2, "npm test", "DONE", "testing\n");
  tool(3, "npm run build", "DONE", "building\n");
  c.event({ event: "result", result: { status: "SUCCESS", response: "ok" } });
  c.close(0);
  await pending;
  const chunks = h.emitted.filter((e) => e.ch === "pty-data").map((e) => e.data);
  const of = (id) => chunks.filter((d) => d.shellId === id).map((d) => d.data).join("");
  assert.match(of("step-2"), /\$ npm test[\s\S]*testing/);
  assert.match(of("step-3"), /\$ npm run build[\s\S]*building/);
  assert.doesNotMatch(of("step-2"), /building/);
});

test("AGY: a saída que o manage_task devolve vai para a aba do comando que iniciou a tarefa", async () => {
  const h = harness(), runner = h.make();
  const pending = runner.execute({ ...payload("antigravity"), responseMessageId: "response-task" });
  await tick();
  const c = h.calls[0].child;
  c.event({ event: "init", conversation_id: "native-task-1" });
  const step = (index, state, info) => c.event({ event: "step_update", step_update: { step_index: index, step_type: "tool", state, tool_info: info } });
  step(2, "ACTIVE", { name: "run_command", parameters: { CommandLine: "npm run build" }, output: "" });
  step(5, "ACTIVE", { name: "manage_task", parameters: { Action: "status", TaskId: "conv-1/task-2" }, output: "" });
  step(5, "DONE", { name: "manage_task", parameters: { Action: "status", TaskId: "conv-1/task-2" }, output: "Command output:\nbuild ok\n" });
  c.event({ event: "result", result: { status: "SUCCESS", response: "ok" } });
  c.close(0);
  await pending;
  const chunks = h.emitted.filter((e) => e.ch === "pty-data").map((e) => e.data);
  assert.match(chunks.filter((d) => d.shellId === "step-2").map((d) => d.data).join(""), /build ok/);
  assert.equal(chunks.some((d) => d.shellId === "step-5"), false, "não cria aba própria para o manage_task");
});

test("Claude e AGY: só comando vira shell; leitura de arquivo e outras ferramentas ficam sem origem", async () => {
  const h = harness(), runner = h.make();
  const pending = runner.execute({ ...payload("claude"), responseMessageId: "resp-read" });
  await tick();
  const child = h.calls[0].child;
  child.event({ type: "system", subtype: "init", session_id: "claude-native-read" });
  child.event({ type: "assistant", message: { content: [
    { type: "tool_use", id: "tool-bash", name: "Bash", input: { command: "npm test" } },
    { type: "tool_use", id: "tool-read", name: "Read", input: { file_path: "/p/a.ts" } },
  ] } });
  child.event({ type: "user", message: { content: [
    { type: "tool_result", tool_use_id: "tool-read", content: "CONTEUDO_DO_ARQUIVO", is_error: false },
    { type: "tool_result", tool_use_id: "tool-bash", content: "TESTES_OK", is_error: false },
  ] } });
  child.event({ type: "result", session_id: "claude-native-read", result: "ok", is_error: false });
  child.close(0);
  await pending;
  const chunks = h.emitted.filter((e) => e.ch === "pty-data").map((e) => e.data);
  const tagged = (id) => chunks.filter((d) => d.shellId === id).map((d) => d.data).join("");
  assert.match(tagged("tool-bash"), /TESTES_OK/);
  assert.equal(chunks.some((d) => d.shellId === "tool-read"), false);
  assert.match(chunks.filter((d) => !d.shellId).map((d) => d.data).join(""), /CONTEUDO_DO_ARQUIVO/, "a saída continua em Tudo");

  const g = harness(), r2 = g.make();
  const p2 = r2.execute({ ...payload("antigravity"), responseMessageId: "response-read" });
  await tick();
  const c = g.calls[0].child;
  c.event({ event: "init", conversation_id: "native-read-1" });
  c.event({ event: "step_update", step_update: { step_index: 2, step_type: "tool", state: "DONE", tool_info: { name: "read_file", parameters: { Path: "/p/a.ts" }, output: "CONTEUDO_AGY" } } });
  c.event({ event: "result", result: { status: "SUCCESS", response: "ok" } });
  c.close(0);
  await p2;
  const agy = g.emitted.filter((e) => e.ch === "pty-data").map((e) => e.data);
  assert.match(agy.map((d) => d.data).join(""), /CONTEUDO_AGY/);
  assert.equal(agy.some((d) => d.shellId), false);
});
