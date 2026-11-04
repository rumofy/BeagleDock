const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  authErrorHosts,
  createStderrFilter,
  createMcpAuthWatcher,
  pendingLogins,
} = require("../electron/codex-mcp-auth");

// Real line emitted by `codex app-server` (codex-cli 0.166.0) with the Postman MCP not signed in.
const REAL_LINE =
  '2026-10-31T12:52:10.767611Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=\\"https://mcp.postman.com/.well-known/oauth-protected-resource/mcp\\"" })';
const LIST = JSON.stringify([
  { name: "figma", enabled: true, auth_status: "o_auth", transport: { url: "https://mcp.figma.com/mcp" } },
  {
    name: "postman-mcp",
    enabled: true,
    auth_status: "not_logged_in",
    transport: { type: "streamable_http", url: "https://mcp.postman.com/mcp" },
  },
]);

test("extracts the host of the MCP that needs sign-in", () => {
  assert.ok(authErrorHosts(REAL_LINE).includes("mcp.postman.com"));
  assert.deepEqual(authErrorHosts("tudo certo em https://exemplo.com"), []);
});

test("lists only enabled MCPs without sign-in", () => {
  assert.deepEqual(pendingLogins(LIST).map((s) => s.name), ["postman-mcp"]);
  assert.deepEqual(pendingLogins("lixo"), []);
});

test("the filter takes out only the MCP authentication line and passes the rest through", () => {
  const shown = [];
  const auth = [];
  const filter = createStderrFilter({
    forward: (text) => shown.push(text),
    onAuthError: (line) => auth.push(line),
  });
  filter("2026-10-31T12:52:09.000000Z WARN codex_core: algo importante\n");
  // the line arrives split in two pieces
  filter(REAL_LINE.slice(0, 60));
  filter(REAL_LINE.slice(60) + "\n");
  filter("erro sem timestamp\n");
  filter("texto parcial sem quebra");
  assert.equal(auth.length, 1);
  assert.match(auth[0], /AuthRequired/);
  assert.deepEqual(shown, [
    "2026-10-31T12:52:09.000000Z WARN codex_core: algo importante\n",
    "erro sem timestamp\n",
    "texto parcial sem quebra",
  ]);
});

test("the notice names the MCP, carries the sign-in command and doesn't repeat", async () => {
  const sent = [];
  let clock = 0;
  const watcher = createMcpAuthWatcher({
    notify: (...args) => sent.push(args),
    find: () => "/bin/codex",
    exec: async () => ({ stdout: LIST }),
    now: () => clock,
  });
  watcher.inspect(REAL_LINE);
  watcher.inspect(REAL_LINE);
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1);
  const [id, category, title, , extra] = sent[0];
  assert.equal(id, "mcp-auth:codex:postman-mcp");
  assert.equal(category, "mcp_auth");
  assert.match(title, /postman-mcp/);
  assert.equal(extra.actionCommand, "codex mcp login postman-mcp");
});

test("without the CLI available it still notifies by host", async () => {
  const sent = [];
  const watcher = createMcpAuthWatcher({
    notify: (...args) => sent.push(args),
    find: () => null,
  });
  watcher.inspect(REAL_LINE);
  await new Promise((r) => setImmediate(r));
  assert.equal(sent[0][0], "mcp-auth:codex:mcp.postman.com");
  assert.deepEqual(sent[0][4], {});
});

test("integrated: the sign-in command reaches the notification kept by the ecosystem", async () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const { createEcosystem } = require("../electron/ecosystem");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-eco-"));
  const eco = createEcosystem({ file: path.join(dir, "ecosystem.json") });
  const watcher = createMcpAuthWatcher({
    notify: (...args) => eco.notifyOnce(...args),
    find: () => "/bin/codex",
    exec: async () => ({ stdout: LIST }),
  });
  watcher.inspect(REAL_LINE);
  await new Promise((r) => setImmediate(r));
  const saved = eco.get().notifications.find((n) => n.id === "mcp-auth:codex:postman-mcp");
  assert.ok(saved, "notification created");
  assert.equal(saved.category, "mcp_auth");
  assert.equal(saved.actionCommand, "codex mcp login postman-mcp");
  // Persisted and reloaded with the command.
  const reloaded = createEcosystem({ file: path.join(dir, "ecosystem.json") });
  assert.equal(reloaded.get().notifications[0].actionCommand, "codex mcp login postman-mcp");
});
