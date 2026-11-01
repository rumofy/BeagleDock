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
  let steerFails = false;
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
          } else if (m.method === "turn/steer") {
            if (steerFails || m.params.expectedTurnId !== child.turnId)
              child.event({ id: m.id, error: { code: -32600, message: "turno não está ativo" } });
            else child.event({ id: m.id, result: { turnId: child.turnId } });
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
  const make = (extra = {}) =>
    createCliRunner({
      ...extra,
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
  return { make, links, calls, events, notify, setWrong: () => (wrong = true), failSteer: () => (steerFails = true) };
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
test("Codex: espera e mensagens não criam agentes nem mudam o pai; saída do filho chega antes da conclusão", async (t) => {
  const h = harness(), runner = h.make();
  t.after(() => runner.shutdown());
  const pending = runner.execute(payload);
  await tick();
  const child = h.calls[0].child;
  const sub = (method, params) => child.event({ method, params: { threadId: "child-1", turnId: "child-turn", ...params } });
  const spawn = { id: "spawn", type: "collabAgentToolCall", tool: "spawnAgent", receiverThreadIds: ["child-1"], agentsStates: { "child-1": { status: "running", message: null } } };
  h.notify("item/started", { item: spawn });
  h.notify("item/completed", { item: { ...spawn, status: "completed" } });
  for (const tool of ["wait", "sendMessage", "wait"]) {
    const item = { id: `${tool}-${child.messages.length}-${h.events.length}`, type: "collabAgentToolCall", tool, receiverThreadIds: ["child-1"] };
    h.notify("item/started", { item });
    h.notify("item/completed", { item: { ...item, status: "completed" } });
  }
  h.notify("item/started", { item: { id: "interacted", type: "subAgentActivity", kind: "interacted", agentThreadId: "child-1" } });
  sub("item/started", { item: { id: "cmd", type: "commandExecution", command: "npm test" } });
  sub("item/commandExecution/outputDelta", { itemId: "cmd", delta: "CHILD_FIRST\n" });
  const shell = () => h.events.filter((e) => e.channel === "pty-data").map((e) => e.data.data).join("");
  assert.match(shell(), /\$ npm test/);
  assert.match(shell(), /CHILD_FIRST/);
  assert.equal(runner.isBusy(payload.sessionId), true);
  const lastAgent = () => h.events.filter((e) => e.channel === "cli-activity-event" && e.data.event.id === "spawn").at(-1).data.event;
  assert.equal(lastAgent().status, "running", "fim de spawn é só a criação, não o fim do trabalho");
  sub("item/completed", { item: { id: "cmd", type: "commandExecution", status: "completed", aggregatedOutput: "CHILD_FIRST\nCHILD_LAST\n" } });
  h.notify("item/completed", { item: { id: "done", type: "subAgentActivity", kind: "completed", agentThreadId: "child-1" } });
  assert.equal(lastAgent().status, "done");
  h.notify("turn/completed", { turn: { status: "completed" } });
  const result = await pending;
  assert.equal(result.events.filter((e) => e.kind === "agent").length, 1);
  assert.equal(result.events.find((e) => e.id === "child-1:cmd").parentId, "spawn");
  assert.equal(shell().split("CHILD_FIRST").length - 1, 1, "snapshot final não duplica o stream");
  assert.match(shell(), /CHILD_LAST/);
});

test("Codex: permissões do filho conhecido aguardam o usuário; conversas alheias continuam negadas", async (t) => {
  const h = harness(), asked = [];
  let decide;
  const approvals = { askDetailed: (request) => (asked.push(request), new Promise((r) => (decide = r))), cancelSession() {}, shutdown() {} };
  const runner = h.make({ approvals });
  t.after(() => runner.shutdown());
  const pending = runner.execute({ ...payload, permission: "edits" });
  await tick();
  const child = h.calls[0].child;
  h.notify("item/started", { item: { id: "spawn", type: "collabAgentToolCall", tool: "spawnAgent", receiverThreadIds: ["child-1"] } });
  child.event({ id: 91, method: "item/commandExecution/requestApproval", params: { threadId: "child-1", command: "npm test" } });
  await tick();
  assert.equal(asked.length, 1);
  assert.equal(asked[0].sessionId, payload.sessionId);
  assert.equal(asked[0].input.threadId, "child-1");
  assert.equal(child.messages.some((m) => m.id === 91), false);
  decide({ allow: true, native: { decision: "acceptForSession" } });
  await tick();
  assert.deepEqual(child.messages.find((m) => m.id === 91).result, { decision: "acceptForSession" });
  child.event({ id: 92, method: "item/commandExecution/requestApproval", params: { threadId: "unrelated", command: "npm test" } });
  assert.deepEqual(child.messages.find((m) => m.id === 92).result, { decision: "decline" });
  assert.equal(asked.length, 1);
  h.notify("turn/completed", { turn: { status: "completed" } });
  await pending;
});
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
test("Codex timeline: reasoning, MCP, plan and compaction appear live and are returned with the turn", async () => {
  const h = harness(),
    runner = h.make(),
    pending = runner.execute(payload);
  await tick();
  const live = () =>
    h.events.filter((e) => e.channel === "cli-activity-event").map((e) => e.data.event);
  h.notify("item/started", { item: { id: "r1", type: "reasoning" } });
  h.notify("item/reasoning/summaryTextDelta", { itemId: "r1", delta: "Analisando os testes" });
  assert.equal(live().at(-1).kind, "reasoning");
  assert.match(live().at(-1).text, /Analisando/);
  assert.equal(live().at(-1).status, "running");
  h.notify("item/started", {
    item: { id: "m1", type: "mcpToolCall", server: "figma", tool: "get_design", arguments: { id: 1 } },
  });
  h.notify("item/mcpToolCall/progress", { itemId: "m1", message: "baixando…" });
  assert.equal(live().at(-1).detail, "baixando…");
  h.notify("turn/plan/updated", {
    explanation: "Plano inicial",
    plan: [{ step: "Ler", status: "completed" }, { step: "Testar", status: "inProgress" }],
  });
  assert.match(live().at(-1).text, /\[x\] Ler\n\[~\] Testar/);
  h.notify("item/started", { item: { id: "c1", type: "contextCompaction" } });
  h.notify("item/completed", { item: { id: "c1", type: "contextCompaction" } });
  h.notify("item/completed", {
    item: { id: "m1", type: "mcpToolCall", server: "figma", tool: "get_design", status: "failed", error: { message: "sem permissão" }, durationMs: 42 },
  });
  h.notify("item/completed", {
    item: { id: "r1", type: "reasoning", summary: ["Analisei os testes e achei a causa"] },
  });
  h.notify("turn/completed", { turn: { status: "completed" } });
  const result = await pending;
  const byId = Object.fromEntries(result.events.map((e) => [e.id, e]));
  assert.equal(byId.m1.status, "error");
  assert.equal(byId.m1.detail, "sem permissão");
  assert.equal(byId.m1.durationMs, 42);
  assert.equal(byId.m1.title, "MCP figma/get_design");
  assert.equal(byId.r1.status, "done");
  assert.match(byId.r1.text, /achei a causa/);
  assert.equal(byId.c1.kind, "compaction");
  assert.equal(byId.c1.status, "done");
  assert.equal(byId.plan.status, "done");
  runner.shutdown();
});

test("app-server do Codex que cai cancela as permissões pendentes da sessão", async () => {
  const h = harness();
  const cancelled = [];
  const approvals = {
    ask: () => new Promise(() => {}), // ninguém responde
    cancelSession: (id) => cancelled.push(id),
    shutdown() {},
  };
  const runner = h.make({ approvals });
  const pending = runner.execute({ ...payload, permission: "edits" });
  await tick();
  const c = h.calls[0].child;
  c.event({ id: "req-1", method: "item/commandExecution/requestApproval", params: { threadId: c.threadId, command: "rm -rf x" } });
  await tick();
  assert.deepEqual(cancelled, [], "ainda não houve queda");
  c.close(1);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.ok(cancelled.includes(payload.sessionId), "a permissão pendente foi cancelada na queda");
  runner.shutdown();
});

test("raciocínio do Codex: resumo e conteúdo não se misturam e o resumo ganha parágrafos", async () => {
  const h = harness(), runner = h.make(), pending = runner.execute(payload);
  await tick();
  const live = () => h.events.filter((e) => e.channel === "cli-activity-event").map((e) => e.data.event).filter((e) => e.id === "r1");
  h.notify("item/started", { item: { id: "r1", type: "reasoning" } });
  h.notify("item/reasoning/summaryTextDelta", { itemId: "r1", delta: "Primeiro ponto" });
  h.notify("item/reasoning/summaryPartAdded", { itemId: "r1" });
  h.notify("item/reasoning/summaryTextDelta", { itemId: "r1", delta: "Segundo ponto" });
  h.notify("turn/completed", { turn: { status: "completed" } });
  const result = await pending;
  const summary = result.events.find((e) => e.id === "r1");
  assert.equal(summary.text, "Primeiro ponto\n\nSegundo ponto");
  assert.ok(live().length >= 2);
  const h2 = harness(), runner2 = h2.make(), pending2 = runner2.execute(payload);
  await tick();
  h2.notify("item/started", { item: { id: "r9", type: "reasoning" } });
  h2.notify("item/reasoning/summaryTextDelta", { itemId: "r9", delta: "resumo" });
  h2.notify("item/reasoning/textDelta", { itemId: "r9", delta: "conteúdo bruto" });
  h2.notify("turn/completed", { turn: { status: "completed" } });
  const r2 = (await pending2).events.find((e) => e.id === "r9");
  assert.equal(r2.text, "conteúdo bruto", "com conteúdo, o resumo não é concatenado");
  runner.shutdown();
  runner2.shutdown();
});

test("progresso de MCP de item desconhecido não cria etapa sem título", async () => {
  const h = harness(), runner = h.make(), pending = runner.execute(payload);
  await tick();
  h.notify("item/mcpToolCall/progress", { itemId: "fantasma", message: "?" });
  h.notify("turn/completed", { turn: { status: "completed" } });
  const result = await pending;
  assert.equal(result.events.some((e) => e.id === "fantasma"), false);
  runner.shutdown();
});

test("Codex: a opção escolhida volta ao app-server no formato nativo (sessão, emenda, cancelar)", async () => {
  const h = harness();
  const answers = [
    { allow: true, optionId: "acceptForSession", native: { decision: "acceptForSession" } },
    { allow: true, optionId: "amend", native: { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["npm", "test"] } } } },
    { allow: false, optionId: "cancel", native: { decision: "cancel" } },
  ];
  const asked = [];
  const approvals = { askDetailed: async (r) => (asked.push(r), answers.shift()), cancelSession() {}, shutdown() {} };
  const runner = h.make({ approvals });
  const pending = runner.execute({ ...payload, permission: "edits" });
  await tick();
  const c = h.calls[0].child;
  for (const id of [701, 702, 703]) {
    c.event({ id, method: "item/commandExecution/requestApproval", params: { threadId: c.threadId, command: "npm test", proposedExecpolicyAmendment: ["npm", "test"] } });
    await tick();
  }
  const reply = (id) => c.messages.find((m) => m.id === id)?.result;
  assert.deepEqual(reply(701), { decision: "acceptForSession" });
  assert.deepEqual(reply(702), { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["npm", "test"] } } });
  assert.deepEqual(reply(703), { decision: "cancel" });
  assert.deepEqual(asked[0].options.map((o) => o.id), ["accept", "acceptForSession", "amend", "decline", "cancel"]);
  assert.equal(asked[0].tool, "item/commandExecution/requestApproval");
  // Permissão adicional mantém o formato próprio (permissions + scope), sem opções inventadas.
  answers.push({ allow: true });
  c.event({ id: 704, method: "item/permissions/requestApproval", params: { threadId: c.threadId, permissions: { network: true } } });
  await tick();
  assert.deepEqual(reply(704), { permissions: { network: true }, scope: "turn" });
  h.notify("turn/completed", { turn: { status: "completed" } });
  await pending;
  runner.shutdown();
});

test("Codex: contexto vem do tokenUsage, compactação é capturada e o comando nativo é enviado", async () => {
  const h = harness(), runner = h.make(), pending = runner.execute(payload);
  await tick();
  const ctxs = () => h.events.filter((e) => e.channel === "cli-context").map((e) => e.data);
  h.notify("thread/tokenUsage/updated", { tokenUsage: { last: { totalTokens: 8200 }, total: { totalTokens: 90000 }, modelContextWindow: 272000 } });
  assert.equal(ctxs().at(-1).used, 8200);
  assert.equal(ctxs().at(-1).window, 272000);
  h.notify("item/started", { item: { id: "c1", type: "contextCompaction" } });
  assert.equal(ctxs().at(-1).compacting, true);
  h.notify("item/completed", { item: { id: "c1", type: "contextCompaction" } });
  assert.equal(ctxs().at(-1).compacting, false);
  assert.equal(ctxs().at(-1).compactions, 1);
  // Durante a execução não compacta; ocioso, envia thread/compact/start.
  assert.match((await runner.compact(payload.sessionId, "codex")).error, /Aguarde/);
  h.notify("turn/completed", { turn: { status: "completed" } });
  const result = await pending;
  assert.equal(result.context.window, 272000);
  const c = h.calls[0].child;
  const compact = runner.compact(payload.sessionId, "codex");
  await tick();
  const request = c.messages.find((m) => m.method === "thread/compact/start");
  assert.equal(request.params.threadId, "native-codex-123");
  c.event({ id: request.id, result: {} });
  // O comando espera a compactação terminar (evento do app-server) antes de responder.
  c.event({ method: "item/completed", params: { threadId: c.threadId, item: { id: "cmp-1", type: "contextCompaction" } } });
  const done = await compact;
  assert.equal(done.ok, true);
  assert.equal(done.context.compactions, 2, "uma automática no turno anterior + esta manual");
  assert.equal((await runner.compact("sem-conversa", "codex")).ok, false);
  assert.match((await runner.compact("x", "antigravity")).error, /AGY/);
  assert.match((await runner.compact("x", "claude")).error, /\/compact/);
  runner.shutdown();
});

// Formato do esquema do protocolo (v2); o disparo de subagentes pelo Codex real NÃO foi verificado.
test("Codex: etapas da conversa de um subagente entram aninhadas sob o agente (formato do esquema)", async () => {
  const h = harness(), runner = h.make(), pending = runner.execute(payload);
  await tick();
  const c = h.calls[0].child;
  const sub = (method, params) => c.event({ method, params: { threadId: "sub-thread-1", turnId: "sub-turn-1", ...params } });
  h.notify("item/started", { item: { id: "collab-1", type: "collabAgentToolCall", tool: "spawn_agent", prompt: "contar arquivos", receiverThreadIds: ["sub-thread-1"], model: "gpt-x" } });
  sub("item/started", { item: { id: "cmd-s1", type: "commandExecution", command: "find . | wc -l" } });
  sub("item/started", { item: { id: "msg-s1", type: "agentMessage" } });
  sub("item/completed", { item: { id: "cmd-s1", type: "commandExecution", status: "completed", durationMs: 12 } });
  // conversa desconhecida: ignorada
  c.event({ method: "item/started", params: { threadId: "outra", item: { id: "x", type: "commandExecution", command: "rm" } } });
  h.notify("item/completed", { item: { id: "collab-1", type: "collabAgentToolCall", tool: "spawn_agent", receiverThreadIds: ["sub-thread-1"], status: "completed" } });
  h.notify("turn/completed", { turn: { status: "completed" } });
  const result = await pending;
  const byId = Object.fromEntries(result.events.map((e) => [e.id, e]));
  assert.equal(byId["collab-1"].kind, "agent");
  assert.equal(byId["collab-1"].meta.threads, 1);
  assert.equal(byId["sub-thread-1:cmd-s1"].parentId, "collab-1");
  assert.equal(byId["sub-thread-1:cmd-s1"].status, "done");
  assert.equal(byId["sub-thread-1:cmd-s1"].durationMs, 12);
  assert.equal(byId["sub-thread-1:msg-s1"], undefined, "mensagens do subagente não viram etapas");
  assert.equal(byId["outra:x"], undefined, "conversa desconhecida é ignorada");
  runner.shutdown();
});

test("Codex: enviar durante a compactação manual espera ela terminar e o fim da compactação não encerra a resposta", async () => {
  const h = harness(), runner = h.make(), first = runner.execute(payload);
  await tick();
  h.notify("turn/completed", { turn: { status: "completed" } });
  await first;
  const c = h.calls[0].child;
  const ctxs = () => h.events.filter((e) => e.channel === "cli-context").map((e) => e.data);
  const compact = runner.compact(payload.sessionId, "codex");
  await tick();
  const request = c.messages.find((m) => m.method === "thread/compact/start");
  c.event({ id: request.id, result: {} });
  c.event({ method: "turn/started", params: { threadId: c.threadId, turn: { id: "turn-compact" } } });
  await tick();
  assert.equal(ctxs().at(-1).compacting, true);
  // A pessoa envia uma mensagem no meio da compactação: ela espera.
  const second = runner.execute({ ...payload, prompt: "segunda", responseMessageId: "response-2" });
  await tick();
  assert.equal(c.messages.filter((m) => m.method === "turn/start").length, 1, "o turno novo ainda não começou");
  // Fim da compactação (evento + fim do turno dela): termina a espera, sem encerrar nada indevidamente.
  c.event({ method: "item/completed", params: { threadId: c.threadId, turnId: "turn-compact", item: { id: "cmp", type: "contextCompaction" } } });
  c.event({ method: "thread/compacted", params: { threadId: c.threadId, turnId: "turn-compact" } });
  c.event({ method: "turn/completed", params: { threadId: c.threadId, turn: { id: "turn-compact", status: "completed" } } });
  const compacted = await compact;
  assert.equal(compacted.ok, true);
  assert.equal(compacted.context, undefined === compacted.context ? undefined : compacted.context);
  assert.equal(ctxs().at(-1).compactions, 1, "dois eventos, uma compactação");
  assert.equal(ctxs().at(-1).lastCompaction.trigger, "manual");
  await tick();
  assert.equal(c.messages.filter((m) => m.method === "turn/start").length, 2, "agora o turno novo começou");
  // Um turn/completed ATRASADO da compactação não pode encerrar a segunda resposta.
  c.event({ method: "turn/completed", params: { threadId: c.threadId, turn: { id: "turn-compact", status: "completed" } } });
  h.notify("item/agentMessage/delta", { itemId: "a2", delta: "resposta real" });
  h.notify("turn/completed", { turn: { id: c.turnId, status: "completed" } });
  const result = await second;
  assert.equal(result.output, "resposta real");
  assert.equal(result.ok, true);
  runner.shutdown();
});

test("Codex: parar a sessão com permissão pendente responde 'cancel' ao app-server", async () => {
  const h = harness();
  const { createApprovalBroker } = require("../electron/approvals");
  const approvals = createApprovalBroker();
  const runner = h.make({ approvals });
  const pending = runner.execute({ ...payload, permission: "edits" });
  await tick();
  const c = h.calls[0].child;
  c.event({ id: 801, method: "item/commandExecution/requestApproval", params: { threadId: c.threadId, command: "rm x" } });
  await tick();
  approvals.cancelSession(payload.sessionId);
  await tick();
  assert.deepEqual(c.messages.find((m) => m.id === 801)?.result, { decision: "cancel" });
  h.notify("turn/completed", { turn: { status: "completed" } });
  await pending;
  runner.shutdown();
});

test("Codex recebe a orientação de saída ao vivo e a etapa de comando com | tail ganha aviso", async () => {
  const h = harness(), runner = h.make(), pending = runner.execute(payload);
  await tick();
  const start = h.calls[0].child.messages.find((m) => m.method === "thread/start");
  assert.match(start.params.developerInstructions, /preserve incremental stdout/);
  h.notify("item/started", { item: { id: "cmd-t", type: "commandExecution", command: "npm test 2>&1 | tail -40" } });
  h.notify("turn/completed", { turn: { status: "completed" } });
  const result = await pending;
  assert.match(result.events.find((e) => e.id === "cmd-t").meta.note, /tail/);
  runner.shutdown();
});

// Formato do esquema do protocolo; agentes do Codex real NÃO foram verificados.
test("Codex: agente ainda em andamento no fim do turno segue rodando e as etapas dele chegam depois, na resposta de origem", async () => {
  const h = harness();
  const late = [];
  const runner = h.make({ onLateEvents: (p) => late.push(p) });
  const pending = runner.execute(payload);
  await tick();
  const c = h.calls[0].child;
  const sub = (method, params) => c.event({ method, params: { threadId: "sub-thread-9", turnId: "sub-turn-9", ...params } });
  h.notify("item/started", { item: { id: "collab-9", type: "collabAgentToolCall", tool: "spawn_agent", prompt: "rodar testes", receiverThreadIds: ["sub-thread-9"], status: "inProgress" } });
  sub("item/started", { item: { id: "cmd-a", type: "commandExecution", command: "npm test 2>&1 | tail -40" } });
  h.notify("turn/completed", { turn: { status: "completed" } });
  const result = await pending;
  const at = Object.fromEntries(result.events.map((e) => [e.id, e]));
  assert.equal(at["collab-9"].status, "running", "o agente não é encerrado com o turno");
  assert.equal(at["sub-thread-9:cmd-a"].status, "running");
  assert.match(at["sub-thread-9:cmd-a"].meta?.note ?? "", /tail/);
  // depois do turno
  sub("item/completed", { item: { id: "cmd-a", type: "commandExecution", status: "completed", durationMs: 40000 } });
  sub("item/started", { item: { id: "cmd-b", type: "commandExecution", command: "git status" } });
  h.notify("item/completed", { item: { id: "collab-9", type: "collabAgentToolCall", tool: "spawnAgent", receiverThreadIds: ["sub-thread-9"], status: "completed", agentsStates: { "sub-thread-9": { status: "completed", message: "Terminou" } } } });
  const emitted = h.events.filter((e) => e.channel === "cli-activity-event").map((e) => e.data).filter((d) => d.responseMessageId === payload.responseMessageId);
  assert.equal(emitted.filter((d) => d.event.id === "collab-9").at(-1).event.status, "done");
  assert.equal(emitted.filter((d) => d.event.id === "sub-thread-9:cmd-a").at(-1).event.status, "done");
  assert.equal(emitted.filter((d) => d.event.id === "sub-thread-9:cmd-b").at(-1).event.parentId, "collab-9");
  runner.shutdown();
});

test("Codex: turno que o app-server começa sozinho vira mensagem nova; compactação e turno vazio são descartados", async () => {
  const h = harness();
  const autos = [];
  const runner = h.make({ onAutoTurn: (p) => autos.push(p) });
  const first = runner.execute(payload);
  await tick();
  h.notify("turn/completed", { turn: { status: "completed" } });
  await first;
  const c = h.calls[0].child;
  const ev = (method, params = {}) => c.event({ method, params: { threadId: c.threadId, ...params } });
  // o agente principal responde sozinho
  ev("turn/started", { turn: { id: "auto-turn-1" } });
  const started = h.events.filter((e) => e.channel === "cli-turn-started");
  assert.equal(started.length, 1);
  assert.match(started[0].data.responseMessageId, /^auto-/);
  ev("item/agentMessage/delta", { turnId: "auto-turn-1", itemId: "m1", delta: "O agente terminou: " });
  ev("item/agentMessage/delta", { turnId: "auto-turn-1", itemId: "m1", delta: "789 testes." });
  const chunk = h.events.filter((e) => e.channel === "cli-stream-chunk" && e.data.responseMessageId === started[0].data.responseMessageId).at(-1);
  assert.equal(chunk.data.fullText, "O agente terminou: 789 testes.");
  ev("turn/completed", { turn: { id: "auto-turn-1", status: "completed" } });
  const finished = h.events.filter((e) => e.channel === "cli-turn-finished");
  assert.equal(finished.length, 1);
  assert.equal(finished[0].data.text, "O agente terminou: 789 testes.");
  assert.equal(autos.length, 1);
  assert.equal(autos[0].discard, false);
  // compactação automática (sem texto): descartada
  ev("turn/started", { turn: { id: "auto-turn-2" } });
  ev("turn/completed", { turn: { id: "auto-turn-2", status: "completed" } });
  assert.equal(autos.at(-1).discard, true);
  // o turno do usuário NÃO é espontâneo
  const before = h.events.filter((e) => e.channel === "cli-turn-started").length;
  const second = runner.execute({ ...payload, prompt: "de novo", responseMessageId: "r2" });
  await tick();
  ev("turn/started", { turn: { id: c.turnId } });
  assert.equal(h.events.filter((e) => e.channel === "cli-turn-started").length, before);
  h.notify("turn/completed", { turn: { status: "completed" } });
  await second;
  runner.shutdown();
});

test("Codex: dois comandos em paralelo saem etiquetados com o id de cada um (shellId)", async () => {
  const h = harness(), runner = h.make(), pending = runner.execute(payload);
  await tick();
  const c = h.calls[0].child;
  h.notify("item/started", { item: { id: "cmd-a", type: "commandExecution", command: "npm test" } });
  h.notify("item/started", { item: { id: "cmd-b", type: "commandExecution", command: "npm run build" } });
  h.notify("item/commandExecution/outputDelta", { itemId: "cmd-b", delta: "building\n" });
  h.notify("item/commandExecution/outputDelta", { itemId: "cmd-a", delta: "testing\n" });
  h.notify("item/completed", { item: { id: "cmd-a", type: "commandExecution", aggregatedOutput: "testing\n" } });
  h.notify("item/completed", { item: { id: "cmd-b", type: "commandExecution", aggregatedOutput: "building\n" } });
  const chunks = h.events.filter((e) => e.channel === "pty-data").map((e) => e.data);
  const of = (id) => chunks.filter((d) => d.shellId === id).map((d) => d.data).join("");
  assert.match(of("cmd-a"), /\$ npm test[\s\S]*testing/);
  assert.doesNotMatch(of("cmd-a"), /building/);
  assert.match(of("cmd-b"), /\$ npm run build[\s\S]*building/);
  assert.doesNotMatch(of("cmd-b"), /testing/);
  assert.ok(chunks.every((d) => d.shellId), "toda saída de comando tem origem");
  h.notify("turn/completed", { turn: { id: c.turnId, status: "completed" } });
  await pending;
  runner.shutdown();
});

test("contrato Codex: turn/start leva imagem como localImage e arquivos como mention (formato nativo do app-server)", async () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-codex-attach-")));
  fs.writeFileSync(path.join(dir, "app.ts"), "export {}");
  const png = "data:image/png;base64," + Buffer.from("PNG").toString("base64");
  const h = harness(), runner = h.make({ attachmentsRoot: path.join(dir, "dados") });
  const pending = runner.execute({
    ...payload, cwd: dir, prompt: "olha @app.ts",
    attachments: [{ id: "a", name: "print.png", type: "image", url: png, sizeText: "1 KB" }],
  });
  await tick();
  const c = h.calls[0].child;
  const start = c.messages.find((m) => m.method === "turn/start");
  assert.deepEqual(start.params.input.map((i) => i.type), ["text", "localImage", "mention"]);
  assert.equal(start.params.input[0].text, "olha @app.ts");
  assert.ok(fs.existsSync(start.params.input[1].path) && start.params.input[1].path.endsWith(".png"));
  assert.deepEqual([start.params.input[2].name, start.params.input[2].path], ["app.ts", path.join(dir, "app.ts")]);
  h.notify("turn/completed", { turn: { id: c.turnId, status: "completed" } });
  await pending;
  runner.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Codex: mensagem durante a execução vai ao turno ativo por turn/steer, sem abrir turno novo", async (t) => {
  const h = harness(), runner = h.make();
  t.after(() => runner.shutdown());
  const pending = runner.execute(payload);
  await tick(); await tick();
  const child = h.calls[0].child;
  assert.ok(await runner.inject({ ...payload, prompt: "e também isto", responseMessageId: "ai-segunda" }));
  const steer = child.messages.find((m) => m.method === "turn/steer");
  assert.equal(steer.params.threadId, "native-codex-123");
  assert.equal(steer.params.expectedTurnId, child.turnId);
  assert.match(JSON.stringify(steer.params.input), /e também isto/);
  assert.equal(child.messages.filter((m) => m.method === "turn/start").length, 1);
  assert.equal(await runner.inject({ ...payload, prompt: "x", effort: "low" }), false, "outra configuração espera na fila");
  h.notify("turn/completed", { turn: { status: "completed" } });
  await pending;
  assert.equal(await runner.inject({ ...payload, prompt: "depois" }), false, "sem turno em andamento");
});

test("Codex: se o turn/steer for recusado (turno já acabou), a mensagem cai na fila", async (t) => {
  const h = harness(), runner = h.make();
  t.after(() => runner.shutdown());
  const pending = runner.execute(payload);
  await tick(); await tick();
  h.failSteer();
  assert.equal(await runner.inject({ ...payload, prompt: "tarde demais" }), false);
  h.notify("turn/completed", { turn: { status: "completed" } });
  await pending;
});

// Compactação automática (issue #58): o limite vai ao app-server do Codex como configuração.
test("Codex: limite de compactação automática vai em model_auto_compact_token_limit (padrão 200 mil, 0 desliga)", async () => {
  for (const [value, expected] of [[undefined, "model_auto_compact_token_limit=200000"], [150000, "model_auto_compact_token_limit=150000"], [0, null]]) {
    const h = harness(), runner = h.make({ getAutoCompactTokens: () => value });
    const pending = runner.execute(payload);
    await tick();
    const args = h.calls[0].args;
    if (expected) assert.ok(args.includes(expected), `esperava ${expected} em ${args.join(" ")}`);
    else assert.ok(!args.some((a) => String(a).includes("model_auto_compact_token_limit")));
    h.notify("turn/completed", { turn: { status: "completed" } });
    await pending;
    runner.shutdown();
  }
});

test("Codex: cada mensagem do agente é um trecho separado (issue #59)", async () => {
  const { SEGMENT_SEPARATOR } = require("../electron/message-segments");
  const h = harness(), runner = h.make();
  const pending = runner.execute(payload);
  await tick();
  h.notify("item/agentMessage/delta", { itemId: "m1", delta: "Vou rodar os testes." });
  h.notify("item/agentMessage/delta", { itemId: "m2", delta: "Passou." });
  assert.equal(
    h.events.filter((e) => e.channel === "cli-stream-chunk").at(-1).data.fullText,
    `Vou rodar os testes.${SEGMENT_SEPARATOR}Passou.`,
  );
  h.notify("turn/completed", { turn: { status: "completed" } });
  const result = await pending;
  assert.equal(result.output, `Vou rodar os testes.${SEGMENT_SEPARATOR}Passou.`);
  runner.shutdown();
});

test("Codex: mensagem entregue por turn/steer abre outra resposta com o texto escrito depois", async () => {
  const h = harness(), runner = h.make();
  const pending = runner.execute(payload);
  await tick(); await tick();
  h.notify("item/agentMessage/delta", { itemId: "m1", delta: "Vou rodar os testes." });
  assert.ok(await runner.inject({ ...payload, prompt: "e o build?", responseMessageId: "ai-segunda" }));
  h.notify("item/agentMessage/delta", { itemId: "m2", delta: "O build passou." });
  const last = h.events.filter((e) => e.channel === "cli-stream-chunk" && e.data.fullText).at(-1).data;
  assert.equal(last.responseMessageId, "ai-segunda");
  assert.equal(last.fullText, "O build passou.");
  h.notify("turn/completed", { turn: { status: "completed" } });
  const result = await pending;
  assert.equal(result.output, "Vou rodar os testes.");
  assert.deepEqual(
    result.followUps.map(({ responseMessageId, text }) => ({ responseMessageId, text })),
    [{ responseMessageId: "ai-segunda", text: "O build passou." }],
  );
  runner.shutdown();
});
