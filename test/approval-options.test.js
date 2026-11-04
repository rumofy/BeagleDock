const { test } = require("node:test");
const assert = require("node:assert/strict");
const { claudeApprovalOptions, codexApprovalOptions, describeClaudeSuggestion, askApproval } = require("../electron/approval-options");
const { createApprovalBroker } = require("../electron/approvals");

// Request captured from the real Claude Code 2.1.316 (default mode, command that writes to /tmp).
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

test("Claude: the real request becomes the native options, with scope and what is permanent", () => {
  const { options, native } = claudeApprovalOptions(REAL_CLAUDE_REQUEST);
  assert.deepEqual(options.map((o) => o.id), ["allow", "suggest-0", "suggest-1", "suggest-2", "deny"]);
  assert.equal(options[1].label, "Always allow Bash(touch /tmp/beagledock-probe-777.txt) in this project (local file, not versioned)");
  assert.equal(options[1].persistent, true);
  assert.equal(options[2].label, "Allow access to /tmp in this session");
  assert.equal(options[2].persistent, undefined);
  assert.equal(options[3].label, "Accept edits automatically in this session");
  assert.equal(options[4].allowsMessage, true);
  assert.deepEqual(native["suggest-2"], { updatedPermissions: [REAL_CLAUDE_REQUEST.permission_suggestions[2]] });
});

test("Claude: without suggestions only allow once and deny; unknown types and block rules are not offered", () => {
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

test("Claude: skipping all permissions is marked as dangerous", () => {
  const { options } = claudeApprovalOptions({ permission_suggestions: [{ type: "setMode", mode: "bypassPermissions", destination: "session" }] });
  assert.equal(options[1].danger, true);
});

test("Codex: a command offers session, policy amendment and both denials; files have no amendment", () => {
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

test("broker: returns the chosen option and the native data, which never goes to the interface", async () => {
  const published = [];
  const broker = createApprovalBroker({ emit: (_c, list) => published.push(list) });
  const { options, native } = claudeApprovalOptions(REAL_CLAUDE_REQUEST);
  const pending = broker.askDetailed({ sessionId: "s", providerId: "claude", tool: "Bash", input: {}, options, native });
  const [view] = broker.list();
  assert.ok(view.options.length === 5);
  assert.ok(!JSON.stringify(view).includes("updatedPermissions"), "the native payload is not exposed");
  broker.resolve(view.id, "suggest-1");
  const result = await pending;
  assert.equal(result.allow, true);
  assert.equal(result.optionId, "suggest-1");
  assert.deepEqual(result.native, { updatedPermissions: [REAL_CLAUDE_REQUEST.permission_suggestions[1]] });
});

test("broker: 'allow' and 'deny' still work, a denial carries the note, a made-up option is refused", async () => {
  const broker = createApprovalBroker();
  const codex = codexApprovalOptions("item/commandExecution/requestApproval", {});
  let p = broker.askDetailed({ sessionId: "s", providerId: "codex", tool: "t", input: {}, ...codex });
  broker.resolve(broker.list()[0].id, "allow");
  assert.equal((await p).optionId, "accept");
  p = broker.askDetailed({ sessionId: "s", providerId: "codex", tool: "t", input: {}, ...codex });
  broker.resolve(broker.list()[0].id, "deny");
  assert.equal((await p).optionId, "decline", "first denial offered");
  p = broker.askDetailed({ sessionId: "s", providerId: "claude", tool: "t", input: {}, ...claudeApprovalOptions({}) });
  broker.resolve(broker.list()[0].id, "deny", { message: "  use the test directory  " });
  const denied = await p;
  assert.equal(denied.allow, false);
  assert.equal(denied.message, "use the test directory");
  p = broker.askDetailed({ sessionId: "s", providerId: "claude", tool: "t", input: {}, ...claudeApprovalOptions({}) });
  assert.throws(() => broker.resolve(broker.list()[0].id, "suggest-99"), /Invalid/);
  assert.throws(() => broker.resolve(broker.list()[0].id, 42), /Invalid/);
  assert.deepEqual(broker.resolve("nao-existe", "allow"), { ok: false });
  broker.cancelSession("s");
  assert.equal((await p).allow, false);
});

test("askApproval works with brokers that only implement ask()", async () => {
  assert.deepEqual(await askApproval({ ask: async () => true }, {}), { allow: true });
  assert.deepEqual(await askApproval(undefined, {}), { allow: false });
});

test("a note on a denial only exists where the CLI receives it (Claude); AGY and Codex don't offer the field", () => {
  const { DENY } = require("../electron/approval-options");
  assert.equal(claudeApprovalOptions({}).options.at(-1).allowsMessage, true);
  assert.equal(codexApprovalOptions("item/commandExecution/requestApproval", {}).options.some((o) => o.allowsMessage), false);
  assert.equal(codexApprovalOptions("item/permissions/requestApproval", {}).options.some((o) => o.allowsMessage), false);
  // a request without options (AGY, through the bridge) uses the default without a note field
  const broker = createApprovalBroker();
  broker.askDetailed({ sessionId: "s", providerId: "antigravity", tool: "run_command", input: {} });
  assert.equal(broker.list()[0].options.some((o) => o.allowsMessage), false);
  assert.equal(DENY.allowsMessage, undefined);
  broker.shutdown();
});

test("a rule for all projects and skipping permissions are marked as dangerous (they ask for confirmation)", () => {
  const { options } = claudeApprovalOptions({ permission_suggestions: [
    { type: "addRules", behavior: "allow", rules: [{ toolName: "Bash", ruleContent: "ls" }], destination: "userSettings" },
    { type: "addRules", behavior: "allow", rules: [{ toolName: "Bash", ruleContent: "ls" }], destination: "localSettings" },
  ] });
  assert.equal(options[1].danger, true);
  assert.equal(options[2].danger, undefined);
});

test("stopping the session answers cancel (not deny) to a pending request", async () => {
  const broker = createApprovalBroker();
  const pending = broker.askDetailed({ sessionId: "s", providerId: "codex", tool: "t", input: {}, ...codexApprovalOptions("item/commandExecution/requestApproval", {}) });
  broker.cancelSession("s");
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.equal(result.allow, false);
});
