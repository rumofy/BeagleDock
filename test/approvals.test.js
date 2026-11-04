const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"),
  os = require("os"),
  path = require("path"),
  net = require("net");
const { createApprovalBroker } = require("../electron/approvals");
const {
  ensureHook,
  createAgyApprovalBridge,
} = require("../electron/agy-approval-bridge");
const { agyPermissionSettings } = require("../electron/agy-permissions");
test("approval IDs are single-use, validated, scoped by session and canceled on shutdown", async () => {
  const events = [],
    broker = createApprovalBroker({
      emit: (c, p) => events.push(p),
      timeout: 10000,
    });
  const a = broker.ask({
      sessionId: "a",
      providerId: "claude",
      tool: "Bash",
      input: { command: "npm test" },
    }),
    b = broker.ask({
      sessionId: "b",
      providerId: "codex",
      tool: "command",
      input: {},
    });
  assert.equal(broker.list().length, 2);
  const id = broker.list()[0].id;
  assert.throws(() => broker.resolve(id, "anything"));
  assert.equal(broker.resolve(id, "allow").ok, true);
  assert.equal(await a, true);
  assert.equal(broker.resolve(id, "allow").ok, false);
  broker.cancelSession("a");
  assert.equal(broker.list().length, 1);
  broker.shutdown();
  assert.equal(await b, false);
  assert.deepEqual(events.at(-1), []);
});
test("AGY hook installation preserves other hooks and backs up the original; malformed config is untouched", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-hooks-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, ".gemini/config/hooks.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = JSON.stringify({
    existing: { SessionStart: [{ command: "example" }] },
  });
  fs.writeFileSync(file, original);
  ensureHook({
    home,
    env: {},
    node: "/fixture/node",
    script: "/fixture/hook.cjs",
  });
  const saved = fs.readFileSync(file, "utf8");
  assert.deepEqual(JSON.parse(saved).existing, JSON.parse(original).existing);
  assert.equal(fs.readFileSync(file + ".before-beagledock", "utf8"), original);
  ensureHook({
    home,
    env: {},
    node: "/fixture/node",
    script: "/fixture/hook.cjs",
  });
  assert.equal(fs.readFileSync(file, "utf8"), saved);
  fs.writeFileSync(file, "{invalid");
  assert.throws(() => ensureHook({ home, env: {} }), /invalid/);
  assert.equal(fs.readFileSync(file, "utf8"), "{invalid");
});
test("AGY hook installation removes legacy hook entries, keeps other hooks and does not duplicate", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-legacy-hooks-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, ".gemini/config/hooks.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const legacyEntry = { PreToolUse: [{ matcher: ".*", hooks: [] }] };
  const keep = { SessionStart: [{ command: "example" }] };
  const original = JSON.stringify({
    mine: keep,
    "capyai-permissions": legacyEntry,
    "bleagledock-permissions": legacyEntry,
  });
  fs.writeFileSync(file, original);
  const options = { home, env: {}, node: "/fixture/node", script: "/fixture/hook.cjs" };
  ensureHook(options);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(saved).sort(), ["beagledock-permissions", "mine"]);
  assert.deepEqual(saved.mine, keep);
  assert.equal(fs.readFileSync(file + ".before-beagledock", "utf8"), original);
  const text = fs.readFileSync(file, "utf8");
  ensureHook(options);
  assert.equal(fs.readFileSync(file, "utf8"), text);
});
function send(socket, message) {
  return new Promise((resolve, reject) => {
    const c = net.createConnection(socket);
    let text = "";
    c.on("connect", () => c.write(JSON.stringify(message) + "\n"));
    c.on("data", (d) => (text += d));
    c.on("error", reject);
    c.on("close", () => resolve(text ? JSON.parse(text) : null));
  });
}
test("AGY approval IPC authenticates the process tree, routes child approvals to its session and never rewrites commands", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-approval-ipc-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const asks = [];
  const bridge = await createAgyApprovalBridge({
    home,
    env: {},
    node: "/fixture/node",
    script: "/fixture/hook.cjs",
    sessionId: "local-session",
    permission: "edits",
    getNativeId: () => "native-session-123",
    ask: async (p) => {
      asks.push(p);
      return p.input.CommandLine === "npm test";
    },
  });
  t.after(() => bridge.close());
  const request = {
      conversationId: "native-session-123",
      toolCall: { name: "run_command", args: { CommandLine: "npm test" } },
    },
    socket = bridge.env.BEAGLEDOCK_APPROVAL_SOCKET,
    token = bridge.env.BEAGLEDOCK_APPROVAL_TOKEN;
  assert.equal(await send(socket, { token: "bad", request }), null);
  assert.equal(asks.length, 0);
  assert.equal(
    (
      await send(socket, {
        token,
        request: { ...request, conversationId: "../invalid-session" },
      })
    ).decision,
    "deny",
  );
  const allowed = await send(socket, { token, request });
  assert.equal(allowed.decision, "auto_approve");
  assert.equal(allowed.overwrite, undefined);
  assert.equal(asks[0].input.CommandLine, "npm test");
  const child = { ...request, conversationId: "child-session-456" };
  assert.equal(await send(socket, { token: "another-session-token", request: child }), null);
  assert.equal((await send(socket, { token, request: child })).decision, "auto_approve");
  assert.equal(asks.at(-1).sessionId, "local-session");
  assert.equal(asks.at(-1).input.agentConversationId, "child-session-456");
  assert.equal(asks.at(-1).input.CommandLine, "npm test");
  assert.equal(
    (
      await send(socket, {
        token,
        request: {
          ...request,
          toolCall: { name: "run_command", args: { CommandLine: "other" } },
        },
      })
    ).decision,
    "deny",
  );
  // Subagent coordination tools and ai-memory reads don't ask for manual confirmation.
  for (const toolCall of [
    { name: "invoke_subagent", args: { TypeName: "self", Role: "Test Runner" } },
    { name: "send_message", args: { Recipient: "native-session-123", Message: "DONE" } },
    { name: "call_mcp_tool", args: { ServerName: "ai-memory", ToolName: "memory_query" } },
  ]) {
    const before = asks.length;
    const res = await send(socket, {
      token,
      request: { conversationId: "child-session-456", toolCall },
    });
    assert.equal(res.decision, "allow");
    assert.equal(asks.length, before);
  }
  // In "inherit" mode ("CLI global"), honors toolPermission: "always-proceed" from settings.json.
  const settingsFile = path.join(home, ".gemini/antigravity-cli/settings.json");
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ toolPermission: "always-proceed" }));
  const inheritBridge = await createAgyApprovalBridge({
    home,
    env: {},
    node: "/fixture/node",
    script: "/fixture/hook.cjs",
    sessionId: "inherit-session",
    permission: "inherit",
    getNativeId: () => "native-session-123",
    ask: async (p) => {
      asks.push(p);
      return false;
    },
  });
  t.after(() => inheritBridge.close());
  const inheritRes = await send(inheritBridge.env.BEAGLEDOCK_APPROVAL_SOCKET, {
    token: inheritBridge.env.BEAGLEDOCK_APPROVAL_TOKEN,
    request: {
      conversationId: "child-session-456",
      toolCall: { name: "run_command", args: { CommandLine: "npm test" } },
    },
  });
  assert.equal(inheritRes.decision, "allow");
  const policy = agyPermissionSettings(
    "edits",
    { deny: ["command(private)"] },
    true,
  );
  assert.ok(policy.permissions.deny.includes("command(private)"));
  assert.equal(policy.permissions.deny.includes("command(*)"), false);
  assert.equal(
    agyPermissionSettings("plan", {}, true).permissions.deny.includes(
      "command(*)",
    ),
    true,
  );
  bridge.close();
  bridge.close();
});

test("a pending approval isn't denied by time: it waits for the decision", async () => {
  const { createApprovalBroker } = require("../electron/approvals");
  const broker = createApprovalBroker();
  let settled = false;
  const pending = broker.ask({ sessionId: "s", providerId: "claude", tool: "Bash", input: {} }).then((v) => {
    settled = v;
    return v;
  });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(broker.list().length, 1);
  assert.equal(settled, false);
  broker.resolve(broker.list()[0].id, "allow");
  assert.equal(await pending, true);
});

test("switching to Full access releases only that conversation's pending approvals, without a permanent rule", async () => {
  const broker = createApprovalBroker();
  const persistent = { id: "always", label: "Always allow", kind: "allow", persistent: true };
  const a = broker.askDetailed({ sessionId: "a", providerId: "claude", tool: "Bash", options: [persistent, { id: "allow", label: "Allow once", kind: "allow" }, { id: "deny", label: "Deny", kind: "deny" }] });
  const b = broker.askDetailed({ sessionId: "b", providerId: "codex", tool: "command" });
  assert.equal(broker.approveSession("a"), 1);
  const decided = await a;
  assert.equal(decided.allow, true);
  assert.equal(decided.optionId, "allow", "never picks the option that saves a permanent rule");
  assert.deepEqual(broker.list().map((r) => r.sessionId), ["b"]);
  assert.equal(broker.approveSession("a"), 0);
  broker.shutdown();
  assert.equal((await b).allow, false);
});

test("switching to full access never approves a plan or answers a question for the person", async () => {
  const broker = createApprovalBroker();
  const plan = broker.askDetailed({
    sessionId: "a", providerId: "claude", kind: "plan", tool: "ExitPlanMode", input: "# Plan",
    options: [{ id: "approve-plan", label: "Approve the plan and run", kind: "allow" }, { id: "deny", label: "Keep planning", kind: "deny" }],
  });
  const question = broker.askDetailed({ sessionId: "a", providerId: "claude", kind: "question", tool: "AskUserQuestion" });
  const tool = broker.askDetailed({ sessionId: "a", providerId: "claude", tool: "Bash" });
  assert.equal(broker.approveSession("a"), 1, "only the tool permission is released");
  assert.equal((await tool).allow, true);
  assert.deepEqual(broker.list().map((r) => r.kind).sort(), ["plan", "question"]);
  broker.shutdown();
  assert.equal((await plan).allow, false);
  assert.equal((await question).allow, false);
});

test("AGY: the approval bridge applies the permission change live", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-approval-live-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const asks = [];
  const make = (permission) =>
    createAgyApprovalBridge({
      home, env: {}, node: "/fixture/node", script: "/fixture/hook.cjs",
      sessionId: "local-session", permission,
      getNativeId: () => "native-session-123",
      ask: async (p) => (asks.push(p), true),
    });
  const bridge = await make("edits");
  t.after(() => bridge.close());
  const { BEAGLEDOCK_APPROVAL_SOCKET: socket, BEAGLEDOCK_APPROVAL_TOKEN: token } = bridge.env;
  const call = (name, args = {}) =>
    send(socket, { token, request: { conversationId: "native-session-123", toolCall: { name, args } } });
  assert.equal((await call("run_command", { CommandLine: "ls" })).decision, "auto_approve");
  assert.equal(asks.length, 1, "in Accept edits the command asks");
  bridge.setPermission("full");
  assert.equal((await call("run_command", { CommandLine: "ls" })).decision, "allow");
  assert.equal(asks.length, 1, "in Full access it doesn't ask anymore");
  bridge.setPermission("plan");
  const denied = await call("write_to_file", { TargetFile: "a.txt" });
  assert.equal(denied.decision, "deny", "it started able to write: the bridge blocks until it restarts in plan mode");
  assert.match(denied.reason, /read-only/);
  assert.equal((await call("run_command", { CommandLine: "ls" })).decision, "deny");
  assert.equal((await call("view_file", { AbsolutePath: "/x" })).decision, "allow", "reading stays allowed");
  bridge.setPermission("edits");
  assert.equal((await call("write_to_file", { TargetFile: "a.txt" })).decision, "allow");
  assert.equal(asks.length, 1);
});
