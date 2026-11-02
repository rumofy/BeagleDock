// Histórico de conversas: o banco do BeagleDock como fonte principal, os arquivos nativos das CLIs
// como complemento, imagens em arquivo (não em base64 no banco), fechar e apagar definitivamente.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-history-"));
process.env.BEAGLEDOCK_DATA_DIR = root;
const store = require("../electron/database");
const { createHistory } = require("../electron/history");
const { createSessionService } = require("../electron/session-service");
const {
  saveAttachments,
  toStoredAttachments,
  fromStoredAttachments,
} = require("../electron/attachments");
after(async () => {
  await new Promise((resolve, reject) => store.db.close((e) => (e ? reject(e) : resolve())));
  fs.rmSync(root, { recursive: true, force: true });
});
const PNG = "data:image/png;base64," + Buffer.from("png-bytes-de-teste").toString("base64");
const session = (id, extra = {}) => ({ id, providerId: "claude", cwd: "/projeto", title: "Conversa", ...extra });
const message = (id, sessionId, text, extra = {}) => ({
  id, sessionId, sender: "user", senderName: "Você", text, timestamp: "t", ...extra,
});
const attachmentsDir = (id) => path.join(root, "attachments", id);
const write = (home, name, value) => {
  const file = path.join(home, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
  return file;
};
const lines = (values) => values.map((v) => JSON.stringify(v)).join("\n") + "\n";

test("imagem da mensagem vai para arquivo: o banco guarda só a referência e a prévia volta ao ler", async () => {
  await store.saveSession(session("img"));
  await store.saveChatMessage(message("m-img", "img", "olha", {
    attachments: [{ id: "a1", name: "print.png", type: "image", url: PNG, sizeText: "1 KB" }],
  }));
  const raw = await new Promise((resolve, reject) =>
    store.db.get("SELECT attachments_json FROM chat_history WHERE id='m-img'", (e, r) => (e ? reject(e) : resolve(r))),
  );
  assert.ok(!raw.attachments_json.includes("base64"), "nada de base64 no banco");
  const stored = JSON.parse(raw.attachments_json)[0];
  assert.match(stored.file, /^[a-f0-9]{32}\.png$/);
  assert.ok(fs.existsSync(path.join(attachmentsDir("img"), stored.file)));
  const [loaded] = await store.getChatMessages("img");
  assert.equal(loaded.attachments[0].url, PNG, "a interface recebe a imagem como antes");
  assert.equal(loaded.attachments[0].file, undefined);
});

test("a cópia enviada à CLI e a do histórico são o mesmo arquivo; repetir a imagem não duplica", () => {
  const sent = saveAttachments({ sessionId: "img", attachments: [{ name: "print", url: PNG }], root });
  const stored = toStoredAttachments({ root, sessionId: "img", attachments: [{ url: PNG, type: "image" }] });
  assert.equal(path.basename(sent[0].path), stored[0].file);
  assert.equal(fs.readdirSync(attachmentsDir("img")).length, 1);
});

test("referência de arquivo fora do padrão não lê nada fora da pasta da conversa", () => {
  write(root, "segredo.png", "x");
  const [item] = fromStoredAttachments({ root, sessionId: "img", attachments: [{ file: "../../segredo.png" }] });
  assert.equal(item.url, "");
  const [missing] = fromStoredAttachments({ root, sessionId: "img", attachments: [{ file: "0".repeat(32) + ".png" }] });
  assert.equal(missing.url, "", "arquivo apagado vira anexo sem prévia");
});

test("bancos antigos com imagem em base64 migram para arquivos ao iniciar", async () => {
  const sqlite3 = require("sqlite3");
  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-legacy-"));
  try {
    const legacy = new sqlite3.Database(path.join(legacyRoot, "beagledock.db"));
    const exec = (sql, args = []) => new Promise((res, rej) => legacy.run(sql, args, (e) => (e ? rej(e) : res())));
    await exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, provider_id TEXT, title TEXT, current_model TEXT, reasoning_effort TEXT, status TEXT, pid INTEGER, cwd TEXT, created_at TEXT, last_active TEXT, permission TEXT, updated_ts TEXT DEFAULT CURRENT_TIMESTAMP)");
    await exec("CREATE TABLE chat_history (id TEXT PRIMARY KEY, session_id TEXT, provider TEXT, sender TEXT, sender_name TEXT, model_badge TEXT, reasoning_badge TEXT, text TEXT, command_snippet TEXT, attachments_json TEXT, timestamp TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
    await exec("INSERT INTO sessions (id,provider_id,title,cwd) VALUES ('old','claude','Antiga','/p')");
    await exec("INSERT INTO chat_history (id,session_id,sender,text,attachments_json) VALUES ('m','old','user','oi',?)", [
      JSON.stringify([{ id: "a", name: "p.png", type: "image", url: PNG }]),
    ]);
    await new Promise((res) => legacy.close(res));
    const { execFileSync } = require("node:child_process");
    const out = execFileSync(process.execPath, ["-e", `
      const s = require(${JSON.stringify(path.resolve("electron/database.js"))});
      s.getChatMessages("old").then((m) => {
        s.db.get("SELECT attachments_json FROM chat_history", (e, r) => {
          console.log(JSON.stringify({ url: m[0].attachments[0].url, raw: r.attachments_json }));
          s.db.close();
        });
      });`], { env: { ...process.env, BEAGLEDOCK_DATA_DIR: legacyRoot }, encoding: "utf8" });
    const result = JSON.parse(out);
    assert.equal(result.url, PNG, "a imagem continua aparecendo");
    assert.ok(!result.raw.includes("base64"), "o base64 saiu do banco");
    assert.equal(fs.readdirSync(path.join(legacyRoot, "attachments", "old")).length, 1);
  } finally {
    fs.rmSync(legacyRoot, { recursive: true, force: true });
  }
});

test("fechadas não carregam mensagens ao iniciar, mas aparecem no histórico e reabrem com tudo", async () => {
  await store.saveSession(session("aberta", { title: "Aberta" }));
  await store.saveChatMessage(message("m-a", "aberta", "primeira pergunta"));
  await store.saveSession(session("fechada", { title: "Fechada", nativeSessionId: "native-fechada-1" }));
  await store.saveChatMessage(message("m-f", "fechada", "assunto raro xyzzy"));
  await store.setSessionArchived("fechada", true);
  const grouped = await store.getAllChatMessagesGrouped();
  assert.ok(grouped.aberta);
  assert.equal(grouped.fechada, undefined);
  const list = await store.listConversationHistory();
  const closed = list.find((h) => h.beagleSessionId === "fechada");
  assert.equal(closed.closed, true);
  assert.equal(closed.source, "beagledock");
  assert.equal(closed.sessionId, "native-fechada-1");
  assert.equal(closed.prompt, "assunto raro xyzzy");
  assert.equal(closed.messageCount, 1);
  assert.ok(Number.isFinite(closed.timestampMs) && closed.timestampMs > 0);
  assert.equal((await store.getChatMessages("fechada")).length, 1, "reabrir lê as mensagens salvas");
  assert.deepEqual(await store.linkedNativeIds(), ["claude:native-fechada-1"]);
});

test("busca do histórico procura no título e no texto das mensagens, com % e _ literais", async () => {
  const ids = (list) => list.map((h) => h.beagleSessionId).sort();
  assert.deepEqual(ids(await store.listConversationHistory("xyzzy")), ["fechada"]);
  assert.deepEqual(ids(await store.listConversationHistory("Aberta")), ["aberta"]);
  assert.deepEqual(await store.listConversationHistory("100%"), []);
});

test("apagar a conversa remove mensagens, vínculo e imagens do disco", async () => {
  assert.ok(fs.existsSync(attachmentsDir("img")));
  await store.deleteSessionFromDb("img");
  assert.equal(await store.sessionExists("img"), false);
  assert.equal(fs.existsSync(attachmentsDir("img")), false);
});

test("fechar encerra o processo da CLI e recusa com resposta em andamento", async () => {
  const killed = [];
  let release, started;
  const startedTurn = new Promise((r) => { started = r; });
  const runner = {
    kill: (id) => killed.push(id),
    execute: () => {
      started();
      return new Promise((resolve) => { release = resolve; });
    },
  };
  const service = createSessionService({ store, runner });
  await service.setSessionArchived("aberta", true);
  assert.deepEqual(killed, ["aberta"]);
  await service.setSessionArchived("aberta", false);
  const turn = service.execute({ sessionId: "aberta", providerId: "claude", prompt: "oi", responseMessageId: "r1" });
  await startedTurn;
  await assert.rejects(service.setSessionArchived("aberta", true), /Pare a execução/);
  assert.deepEqual(killed, ["aberta"], "não mata a resposta em andamento");
  release({ ok: true, text: "ok" });
  await turn;
});

function nativeHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-native-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cwd = "/projeto";
  // Conversa sem terminal (modo headless): não está no history.jsonl, só em projects/.
  write(home, ".claude/projects/-projeto/aaaaaaaa-0001.jsonl", lines([
    { type: "queue-operation", content: "x" },
    { type: "user", isMeta: true, cwd, message: { content: "<local-command-caveat>" } },
    { type: "user", cwd, message: { content: [{ type: "text", text: "conversa feita sem terminal" }] } },
  ]));
  write(home, ".claude/projects/-projeto/aaaaaaaa-0001/subagents/agent-1.jsonl", lines([{ type: "user" }]));
  // Sessão de comando interno, sem mensagem de verdade: não entra no histórico.
  write(home, ".claude/projects/-projeto/bbbbbbbb-0002.jsonl", lines([
    { type: "user", cwd, message: { content: "/context" } },
  ]));
  write(home, ".claude/projects/-projeto/cccccccc-0003.jsonl", lines([
    { type: "user", cwd, message: { content: "já ligada ao BeagleDock" } },
  ]));
  write(home, ".claude/history.jsonl", lines([
    { sessionId: "aaaaaaaa-0001", project: cwd, display: "texto", timestamp: 1 },
    { sessionId: "outra-sessao-9", project: cwd, display: "fica", timestamp: 2 },
  ]));
  write(home, ".codex/sessions/2026/11/01/rollout-2026-11-01-codex-com-msg-1.jsonl", lines([
    { type: "session_meta", payload: { id: "codex-com-msg-1", cwd } },
    { type: "event_msg", payload: { type: "user_message", message: "pergunta no codex" } },
  ]));
  write(home, ".codex/sessions/2026/11/01/rollout-2026-11-01-codex-vazia-2.jsonl", lines([
    { type: "session_meta", payload: { id: "codex-vazia-2", cwd: "/tmp/sonda" } },
  ]));
  write(home, ".codex/session_index.jsonl", lines([
    { id: "codex-com-msg-1", thread_name: "Título do Codex" },
    { id: "outra-thread-99", thread_name: "fica" },
  ]));
  write(home, ".gemini/antigravity-cli/history.jsonl", lines([
    { conversationId: "agy-conversa-1", workspace: cwd, display: "oi agy", timestamp: new Date().toISOString() },
  ]));
  write(home, ".gemini/antigravity-cli/brain/agy-conversa-1/.system_generated/logs/transcript.jsonl", lines([
    { type: "USER_INPUT", content: "oi agy" },
  ]));
  return home;
}

test("histórico nativo: inclui conversas sem terminal, ignora sessões vazias e as já ligadas", (t) => {
  const home = nativeHome(t);
  const reader = createHistory({ home, env: {} });
  const list = reader.history({ exclude: ["claude:cccccccc-0003"] });
  const keys = list.map((h) => h.id).sort();
  assert.deepEqual(keys, ["antigravity:agy-conversa-1", "claude:aaaaaaaa-0001", "codex:codex-com-msg-1"]);
  const claude = list.find((h) => h.provider === "claude");
  assert.equal(claude.prompt, "conversa feita sem terminal");
  assert.equal(claude.source, "native");
  assert.equal(claude.providerName, "Claude Code");
  assert.equal(list.find((h) => h.provider === "codex").title, "Título do Codex");
  assert.deepEqual(reader.history({ query: "CODEX" }).map((h) => h.id), ["codex:codex-com-msg-1"]);
});

test("apagar a conversa nativa remove arquivo, pasta auxiliar e linhas dos índices das três CLIs", (t) => {
  const home = nativeHome(t);
  const reader = createHistory({ home, env: {} });
  reader.remove("claude", "aaaaaaaa-0001");
  assert.equal(fs.existsSync(path.join(home, ".claude/projects/-projeto/aaaaaaaa-0001.jsonl")), false);
  assert.equal(fs.existsSync(path.join(home, ".claude/projects/-projeto/aaaaaaaa-0001")), false);
  const claudeIndex = fs.readFileSync(path.join(home, ".claude/history.jsonl"), "utf8");
  assert.ok(!claudeIndex.includes("aaaaaaaa-0001") && claudeIndex.includes("outra-sessao-9"));
  assert.ok(fs.existsSync(path.join(home, ".claude/projects/-projeto/bbbbbbbb-0002.jsonl")), "as outras ficam");

  reader.remove("codex", "codex-com-msg-1");
  assert.equal(fs.readdirSync(path.join(home, ".codex/sessions/2026/11/01")).length, 1);
  const codexIndex = fs.readFileSync(path.join(home, ".codex/session_index.jsonl"), "utf8");
  assert.ok(!codexIndex.includes("codex-com-msg-1") && codexIndex.includes("outra-thread-99"));

  reader.remove("antigravity", "agy-conversa-1");
  assert.equal(fs.existsSync(path.join(home, ".gemini/antigravity-cli/brain/agy-conversa-1")), false);
  assert.ok(!fs.readFileSync(path.join(home, ".gemini/antigravity-cli/history.jsonl"), "utf8").includes("agy-conversa-1"));

  assert.deepEqual(reader.history().map((h) => h.id), ["claude:cccccccc-0003"], "só sobra a que não foi apagada");
  assert.throws(() => reader.remove("claude", "../../etc"), /inválido/);
  assert.throws(() => reader.remove("outra", "aaaaaaaa-0001"), /inválido/);
});

test("otimização de imagem: limita o maior lado e troca a extensão para .webp", () => {
  const out = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/imageOptimize.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ctx = { exports: {}, Math, Set };
  vm.runInNewContext(out, ctx);
  const lib = ctx.exports;
  assert.deepEqual({ ...lib.fitWithin(2519, 1430) }, { width: 2519, height: 1430, resized: false });
  assert.deepEqual({ ...lib.fitWithin(5152, 2860) }, { width: 2576, height: 1430, resized: true });
  assert.deepEqual({ ...lib.fitWithin(1000, 8000) }, { width: 322, height: 2576, resized: true });
  assert.equal(lib.webpName("print.png"), "print.webp");
  assert.equal(lib.webpName("captura"), "captura.webp");
  assert.equal(lib.canOptimize("image/gif"), false, "GIF pode ser animado");
  assert.equal(lib.canOptimize("image/png"), true);
});
