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
  assert.throws(() => ensureHook({ home, env: {} }), /inválido/);
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
test("AGY approval IPC authenticates requests, matches the native conversation, delegates outside approved modes and never rewrites commands", async (t) => {
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
        request: { ...request, conversationId: "other-session-123" },
      })
    ).decision,
    "deny",
  );
  const allowed = await send(socket, { token, request });
  assert.equal(allowed.decision, "auto_approve");
  assert.equal(allowed.overwrite, undefined);
  assert.equal(asks[0].input.CommandLine, "npm test");
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
