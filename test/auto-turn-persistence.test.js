const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-auto-"));
process.env.BEAGLEDOCK_DATA_DIR = root;
const store = require("../electron/database");
const { createSessionService } = require("../electron/session-service");
after(async () => {
  await new Promise((resolve, reject) => store.db.close((e) => (e ? reject(e) : resolve())));
  fs.rmSync(root, { recursive: true, force: true });
});
const service = createSessionService({ store, runner: { kill() {}, execute: async () => ({ ok: true }), isBusy: () => false, shutdown() {} } });
const payload = (extra = {}) => ({ sessionId: "s-auto", providerId: "claude", responseMessageId: "auto-1", ok: true, text: "Os testes passaram: 789.", events: [{ id: "e", kind: "agent", title: "Agente", status: "done" }], model: "claude-sonnet-5-5", context: { used: 1200, window: 1000000, windowKnown: true }, ...extra });

test("the spontaneous turn is saved as a reply of the conversation, with the timeline and the context", async () => {
  await store.saveSession({ id: "s-auto", providerId: "claude", cwd: root, title: "t" });
  await service.saveAutoTurn(payload());
  const [message] = await store.getChatMessages("s-auto");
  assert.equal(message.id, "auto-1");
  assert.equal(message.sender, "claude");
  assert.equal(message.senderName, "Claude Code");
  assert.equal(message.text, "Os testes passaram: 789.");
  assert.equal(message.events[0].kind, "agent");
  assert.equal((await store.getSavedSessions())[0].context.used, 1200);
});

test("discarded, without a conversation or failed: nothing disappears or breaks", async () => {
  await service.saveAutoTurn(payload({ responseMessageId: "auto-2", discard: true }));
  await service.saveAutoTurn(payload({ responseMessageId: "auto-3", sessionId: "nao-existe" }));
  await service.saveAutoTurn(payload({ responseMessageId: "auto-4", ok: false, text: "", error: "CLI encerrou" }));
  await service.saveAutoTurn(undefined);
  const messages = await store.getChatMessages("s-auto");
  assert.deepEqual(messages.map((m) => m.id), ["auto-1", "auto-4"]);
  assert.equal(messages[1].text, "Error: CLI encerrou");
});
