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

test("archiving marks the conversation and unarchiving undoes it, without deleting the history", async () => {
  await store.saveSession(session("s1"));
  await store.saveChatMessage({ id: "m1", sessionId: "s1", sender: "user", senderName: "F", text: "oi", timestamp: "t" });
  assert.equal((await store.getSavedSessions())[0].archived, false);
  await store.setSessionArchived("s1", true);
  const [archived] = await store.getSavedSessions();
  assert.equal(archived.archived, true);
  assert.equal((await store.getChatMessages("s1")).length, 1, "history preserved");
  await store.setSessionArchived("s1", false);
  assert.equal((await store.getSavedSessions())[0].archived, false);
});

test("saving the conversation again (rename, change model) doesn't unarchive it", async () => {
  await store.setSessionArchived("s1", true);
  await store.saveSession(session("s1", { title: "Novo nome", currentModel: "x" }));
  const [saved] = await store.getSavedSessions();
  assert.equal(saved.title, "Novo nome");
  assert.equal(saved.archived, true);
});

test("archiving a missing conversation fails clearly", async () => {
  await assert.rejects(store.setSessionArchived("nao-existe", true), /doesn't exist/);
});

test("a name given by the person stays locked and survives new saves", async () => {
  await store.saveSession(session("s2", { title: "ok", titleLocked: true }));
  assert.equal((await store.getSavedSessions()).find((s) => s.id === "s2").titleLocked, true);
  // a later save that doesn't send the flag (the automatic title) doesn't undo it
  await store.saveSession(session("s2", { title: "ok" }));
  assert.equal((await store.getSavedSessions()).find((s) => s.id === "s2").titleLocked, true);
});
