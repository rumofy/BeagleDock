const { test } = require("node:test");
const assert = require("node:assert/strict");
const { claudeApprovalOptions, codexApprovalOptions, describeClaudeSuggestion, askApproval } = require("../electron/approval-options");
const { createApprovalBroker } = require("../electron/approvals");

// Pedido capturado do Claude Code 2.1.316 real (modo padrão, comando que escreve em /tmp).
const REAL_CLAUDE_REQUEST = {
  subtype: "can_use_tool",
  tool_name: "Bash",
  display_name: "Bash",
  input: { command: "touch /tmp/beagledock-probe-777.txt", description: "Create the probe file in /tmp" },
  permission_suggestions: [
    { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "touch /tmp/beagledock-probe-777.txt" }], behavior: "allow", destination: "localSettings" },
    { type: "addDirectories", directories: ["/tmp"], destination: "session" },
    { type: "setMode", mode: "acceptEdits", destination: "session" },
  ],
  blocked_path: "/tmp/beagledock-probe-777.txt",
};

test("Claude: o pedido real vira as opções nativas, com escopo e o que é permanente", () => {
  const { options, native } = claudeApprovalOptions(REAL_CLAUDE_REQUEST);
  assert.deepEqual(options.map((o) => o.id), ["allow", "suggest-0", "suggest-1", "suggest-2", "deny"]);
  assert.equal(options[1].label, "Permitir sempre Bash(touch /tmp/beagledock-probe-777.txt) neste projeto (arquivo local, não versionado)");
  assert.equal(options[1].persistent, true);
  assert.equal(options[2].label, "Permitir acesso a /tmp nesta sessão");
  assert.equal(options[2].persistent, undefined);
  assert.equal(options[3].label, "Aceitar edições automaticamente nesta sessão");
  assert.equal(options[4].allowsMessage, true);
  assert.deepEqual(native["suggest-2"], { updatedPermissions: [REAL_CLAUDE_REQUEST.permission_suggestions[2]] });
});

test("Claude: sem sugestões só permitir uma vez e negar; tipos desconhecidos e regras de bloqueio não são oferecidos", () => {
  assert.deepEqual(claudeApprovalOptions({}).options.map((o) => o.id), ["allow", "deny"]);
  const odd = claudeApprovalOptions({
    permission_suggestions: [
      { type: "futuro", foo: 1 },
      { type: "addRules", behavior: "deny", rules: [{ toolName: "Bash" }], destination: "session" },
      { type: "setMode", mode: "modo-inexistente", destination: "session" },
    ],
  });
  assert.deepEqual(odd.options.map((o) => o.id), ["allow", "deny"]);
  assert.equal(describeClaudeSuggestion(null), null);
});

test("Claude: ignorar todas as permissões é marcado como perigoso", () => {
  const { options } = claudeApprovalOptions({ permission_suggestions: [{ type: "setMode", mode: "bypassPermissions", destination: "session" }] });
  assert.equal(options[1].danger, true);
});

test("Codex: comando oferece sessão, emenda de política e as duas negações; arquivos não têm emenda", () => {
  const command = codexApprovalOptions("item/commandExecution/requestApproval", { proposedExecpolicyAmendment: ["npm", "test"] });
  assert.deepEqual(command.options.map((o) => o.id), ["accept", "acceptForSession", "amend", "decline", "cancel"]);
  assert.equal(command.options[2].persistent, true);
  assert.deepEqual(command.native.amend, { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["npm", "test"] } } });
  assert.deepEqual(command.native.cancel, { decision: "cancel" });
  const file = codexApprovalOptions("item/fileChange/requestApproval", { proposedExecpolicyAmendment: ["x"] });
  assert.deepEqual(file.options.map((o) => o.id), ["accept", "acceptForSession", "decline", "cancel"]);
  const other = codexApprovalOptions("item/permissions/requestApproval", {});
  assert.deepEqual(other.options.map((o) => o.id), ["allow", "deny"]);
  assert.deepEqual(codexApprovalOptions("item/commandExecution/requestApproval", { proposedExecpolicyAmendment: [1] }).options.map((o) => o.id), ["accept", "acceptForSession", "decline", "cancel"]);
});

test("broker: devolve a opção escolhida e o dado nativo, que nunca vai para a interface", async () => {
  const published = [];
  const broker = createApprovalBroker({ emit: (_c, list) => published.push(list) });
  const { options, native } = claudeApprovalOptions(REAL_CLAUDE_REQUEST);
  const pending = broker.askDetailed({ sessionId: "s", providerId: "claude", tool: "Bash", input: {}, options, native });
  const [view] = broker.list();
  assert.ok(view.options.length === 5);
  assert.ok(!JSON.stringify(view).includes("updatedPermissions"), "o payload nativo não é exposto");
  broker.resolve(view.id, "suggest-1");
  const result = await pending;
  assert.equal(result.allow, true);
  assert.equal(result.optionId, "suggest-1");
  assert.deepEqual(result.native, { updatedPermissions: [REAL_CLAUDE_REQUEST.permission_suggestions[1]] });
});

test("broker: 'allow' e 'deny' continuam valendo, negação leva a instrução, opção inventada é recusada", async () => {
  const broker = createApprovalBroker();
  const codex = codexApprovalOptions("item/commandExecution/requestApproval", {});
  let p = broker.askDetailed({ sessionId: "s", providerId: "codex", tool: "t", input: {}, ...codex });
  broker.resolve(broker.list()[0].id, "allow");
  assert.equal((await p).optionId, "accept");
  p = broker.askDetailed({ sessionId: "s", providerId: "codex", tool: "t", input: {}, ...codex });
  broker.resolve(broker.list()[0].id, "deny");
  assert.equal((await p).optionId, "decline", "primeira negação oferecida");
  p = broker.askDetailed({ sessionId: "s", providerId: "claude", tool: "t", input: {}, ...claudeApprovalOptions({}) });
  broker.resolve(broker.list()[0].id, "deny", { message: "  use o diretório de testes  " });
  const denied = await p;
  assert.equal(denied.allow, false);
  assert.equal(denied.message, "use o diretório de testes");
  p = broker.askDetailed({ sessionId: "s", providerId: "claude", tool: "t", input: {}, ...claudeApprovalOptions({}) });
  assert.throws(() => broker.resolve(broker.list()[0].id, "suggest-99"), /inválida/);
  assert.throws(() => broker.resolve(broker.list()[0].id, 42), /inválida/);
  assert.deepEqual(broker.resolve("nao-existe", "allow"), { ok: false });
  broker.cancelSession("s");
  assert.equal((await p).allow, false);
});

test("askApproval funciona com brokers que só implementam ask()", async () => {
  assert.deepEqual(await askApproval({ ask: async () => true }, {}), { allow: true });
  assert.deepEqual(await askApproval(undefined, {}), { allow: false });
});

test("instrução na negação só existe onde a CLI a recebe (Claude); AGY e Codex não oferecem o campo", () => {
  const { DENY } = require("../electron/approval-options");
  assert.equal(claudeApprovalOptions({}).options.at(-1).allowsMessage, true);
  assert.equal(codexApprovalOptions("item/commandExecution/requestApproval", {}).options.some((o) => o.allowsMessage), false);
  assert.equal(codexApprovalOptions("item/permissions/requestApproval", {}).options.some((o) => o.allowsMessage), false);
  // pedido sem opções (AGY, pela ponte) usa o padrão sem campo de instrução
  const broker = createApprovalBroker();
  broker.askDetailed({ sessionId: "s", providerId: "antigravity", tool: "run_command", input: {} });
  assert.equal(broker.list()[0].options.some((o) => o.allowsMessage), false);
  assert.equal(DENY.allowsMessage, undefined);
  broker.shutdown();
});

test("regra para todos os projetos e ignorar permissões são marcadas como perigosas (pedem confirmação)", () => {
  const { options } = claudeApprovalOptions({ permission_suggestions: [
    { type: "addRules", behavior: "allow", rules: [{ toolName: "Bash", ruleContent: "ls" }], destination: "userSettings" },
    { type: "addRules", behavior: "allow", rules: [{ toolName: "Bash", ruleContent: "ls" }], destination: "localSettings" },
  ] });
  assert.equal(options[1].danger, true);
  assert.equal(options[2].danger, undefined);
});

test("parar a sessão responde cancelar (não negar) a um pedido pendente", async () => {
  const broker = createApprovalBroker();
  const pending = broker.askDetailed({ sessionId: "s", providerId: "codex", tool: "t", input: {}, ...codexApprovalOptions("item/commandExecution/requestApproval", {}) });
  broker.cancelSession("s");
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.equal(result.allow, false);
});
