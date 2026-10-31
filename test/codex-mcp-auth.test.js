const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  authErrorHosts,
  createStderrFilter,
  createMcpAuthWatcher,
  pendingLogins,
} = require("../electron/codex-mcp-auth");

// Linha real emitida pelo `codex app-server` (codex-cli 0.166.0) com o MCP do Postman sem login.
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

test("extrai o host do MCP que exige login", () => {
  assert.ok(authErrorHosts(REAL_LINE).includes("mcp.postman.com"));
  assert.deepEqual(authErrorHosts("tudo certo em https://exemplo.com"), []);
});

test("lista só MCPs habilitados e sem login", () => {
  assert.deepEqual(pendingLogins(LIST).map((s) => s.name), ["postman-mcp"]);
  assert.deepEqual(pendingLogins("lixo"), []);
});

test("filtro retira só a linha de autenticação do MCP e repassa o resto", () => {
  const shown = [];
  const auth = [];
  const filter = createStderrFilter({
    forward: (text) => shown.push(text),
    onAuthError: (line) => auth.push(line),
  });
  filter("2026-10-31T12:52:09.000000Z WARN codex_core: algo importante\n");
  // a linha chega fatiada em dois pedaços
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

test("aviso identifica o MCP, traz o comando de login e não repete", async () => {
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

test("sem a CLI disponível ainda avisa pelo host", async () => {
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

test("integrado: o comando de login chega até a notificação guardada pelo ecosystem", async () => {
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
  assert.ok(saved, "notificação criada");
  assert.equal(saved.category, "mcp_auth");
  assert.equal(saved.actionCommand, "codex mcp login postman-mcp");
  // Persistida e recarregada com o comando.
  const reloaded = createEcosystem({ file: path.join(dir, "ecosystem.json") });
  assert.equal(reloaded.get().notifications[0].actionCommand, "codex mcp login postman-mcp");
});
