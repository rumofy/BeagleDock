const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-archive-"));
process.env.BEAGLEDOCK_DATA_DIR = root;
const store = require("../electron/database");
after(async () => {
  await new Promise((resolve, reject) => store.db.close((e) => (e ? reject(e) : resolve())));
  fs.rmSync(root, { recursive: true, force: true });
});
const session = (id, extra = {}) => ({ id, providerId: "claude", cwd: root, title: "Conversa", ...extra });

test("arquivar marca a conversa e desarquivar desfaz, sem apagar o histórico", async () => {
  await store.saveSession(session("s1"));
  await store.saveChatMessage({ id: "m1", sessionId: "s1", sender: "user", senderName: "F", text: "oi", timestamp: "t" });
  assert.equal((await store.getSavedSessions())[0].archived, false);
  await store.setSessionArchived("s1", true);
  const [archived] = await store.getSavedSessions();
  assert.equal(archived.archived, true);
  assert.equal((await store.getChatMessages("s1")).length, 1, "histórico preservado");
  await store.setSessionArchived("s1", false);
  assert.equal((await store.getSavedSessions())[0].archived, false);
});

test("salvar a conversa de novo (renomear, trocar modelo) não desarquiva", async () => {
  await store.setSessionArchived("s1", true);
  await store.saveSession(session("s1", { title: "Novo nome", currentModel: "x" }));
  const [saved] = await store.getSavedSessions();
  assert.equal(saved.title, "Novo nome");
  assert.equal(saved.archived, true);
});

test("arquivar conversa inexistente falha de forma clara", async () => {
  await assert.rejects(store.setSessionArchived("nao-existe", true), /inexistente/);
});

test("nome dado pela pessoa fica travado e sobrevive a novos salvamentos", async () => {
  await store.saveSession(session("s2", { title: "ok", titleLocked: true }));
  assert.equal((await store.getSavedSessions()).find((s) => s.id === "s2").titleLocked, true);
  // um salvamento posterior que não informa o flag (o título automático) não o desfaz
  await store.saveSession(session("s2", { title: "ok" }));
  assert.equal((await store.getSavedSessions()).find((s) => s.id === "s2").titleLocked, true);
});
