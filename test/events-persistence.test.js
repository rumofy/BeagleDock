const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-events-"));
process.env.BEAGLEDOCK_DATA_DIR = root;
const store = require("../electron/database");
after(async () => {
  await new Promise((resolve, reject) => store.db.close((e) => (e ? reject(e) : resolve())));
  fs.rmSync(root, { recursive: true, force: true });
});
const session = { id: "s-events", providerId: "claude", cwd: root, title: "t" };
const reply = (extra = {}) => ({
  id: "r1", sessionId: "s-events", sender: "claude", senderName: "Claude",
  text: "pronto", timestamp: "2026-01-01T00:00:00Z", ...extra,
});
const event = (extra = {}) => ({ id: "e1", kind: "command", title: "Bash", detail: "npm test", status: "done", startedAt: 1, endedAt: 5, durationMs: 4, exitCode: 0, ...extra });

test("a linha do tempo é gravada e volta junto com a resposta", async () => {
  await store.saveSession(session);
  await store.saveChatMessage(reply({ events: [event(), event({ id: "e2", kind: "reasoning", title: "R", text: "pensei" })] }));
  const [message] = await store.getChatMessages("s-events");
  assert.equal(message.events.length, 2);
  assert.equal(message.events[0].detail, "npm test");
  assert.equal(message.events[0].exitCode, 0);
  assert.equal(message.events[1].text, "pensei");
});

test("salvar a mesma resposta sem eventos (o renderer) não apaga a linha do tempo", async () => {
  await store.saveChatMessage(reply({ text: "pronto, de novo" }));
  const [message] = await store.getChatMessages("s-events");
  assert.equal(message.text, "pronto, de novo");
  assert.equal(message.events.length, 2);
});

test("itens inválidos na lista de eventos são descartados em vez de quebrar o salvamento", async () => {
  await store.saveChatMessage(reply({ id: "r2", events: [null, 7, "x", event({ id: "ok" })] }));
  const messages = await store.getChatMessages("s-events");
  const saved = messages.find((m) => m.id === "r2");
  assert.deepEqual(saved.events.map((e) => e.id), ["ok"]);
});

test("replaceChatMessages preserva a linha do tempo e normaliza o estado", async () => {
  const current = await store.getChatMessages("s-events");
  await store.replaceChatMessages("s-events", current.map((m) => ({ ...m, sessionId: "s-events" })));
  const after = await store.getChatMessages("s-events");
  assert.equal(after.find((m) => m.id === "r1").events.length, 2);
  await store.saveChatMessage(reply({ id: "r3", events: [event({ id: "x", status: "qualquer" })] }));
  const r3 = (await store.getChatMessages("s-events")).find((m) => m.id === "r3");
  assert.equal(r3.events[0].status, "done", "estado desconhecido vira concluído");
});

test("limita a quantidade e o tamanho do que é gravado", async () => {
  const many = Array.from({ length: 400 }, (_, i) => event({ id: `m${i}`, detail: "d".repeat(900), text: "t".repeat(9000) }));
  await store.saveChatMessage(reply({ id: "r4", events: many }));
  const r4 = (await store.getChatMessages("s-events")).find((m) => m.id === "r4");
  assert.ok(r4.events.length <= 300);
  assert.ok(r4.events[0].detail.length <= 400);
  assert.ok((r4.events[0].text || "").length <= 4000);
});

test("etapas de agentes guardam o pai e os dados do agente, só com campos conhecidos", async () => {
  await store.saveChatMessage(reply({ id: "r5", events: [
    event({ id: "ag", kind: "agent", title: "Agente x", meta: { tokens: 13780, toolUses: 1, subagentType: "general-purpose", lastTool: "Bash", perigo: "<script>", taskId: "t1" } }),
    event({ id: "fi", kind: "command", parentId: "ag" }),
  ] }));
  const r5 = (await store.getChatMessages("s-events")).find((m) => m.id === "r5");
  assert.equal(r5.events[1].parentId, "ag");
  assert.deepEqual(r5.events[0].meta, { tokens: 13780, toolUses: 1, subagentType: "general-purpose", lastTool: "Bash", taskId: "t1" });
});

test("atualização tardia mescla por id na resposta gravada, sem apagar o resto da linha do tempo", async () => {
  await store.saveChatMessage(reply({ id: "r6", events: [
    event({ id: "cmd", status: "done" }),
    event({ id: "ag", kind: "agent", title: "Agente", status: "running", meta: { background: true } }),
  ] }));
  await store.mergeMessageEvents("s-events", "r6", [
    event({ id: "ag", kind: "agent", title: "Agente", status: "done", text: "pronto", meta: { background: true, tokens: 4000 } }),
    event({ id: "ag-filho", kind: "command", parentId: "ag", status: "done" }),
  ]);
  const r6 = (await store.getChatMessages("s-events")).find((m) => m.id === "r6");
  assert.deepEqual(r6.events.map((e) => e.id), ["cmd", "ag", "ag-filho"]);
  assert.equal(r6.events[1].status, "done");
  assert.equal(r6.events[1].meta.tokens, 4000);
  assert.equal(r6.events[1].meta.background, true);
  assert.equal(r6.events[2].parentId, "ag");
  assert.deepEqual(await store.mergeMessageEvents("s-events", "nao-existe", [event()]), { success: false });
});

test("mensagem entregue no meio de uma resposta: o histórico reaberto mantém a ordem vista na tela", async () => {
  const ms = (offset) => new Date(Date.now() + offset).toISOString().replace("T", " ").replace("Z", "");
  const m = (id, sender, extra) => ({ id, sessionId: "s-order", sender, senderName: sender, text: id, timestamp: "t", ...extra });
  await store.saveSession({ ...session, id: "s-order" });
  await store.saveChatMessage(m("u1", "user"));
  await store.saveChatMessage(m("u2", "user"));
  // As respostas são gravadas no fim do turno, depois das duas mensagens do usuário.
  await store.saveChatMessage(m("a1", "claude", { createdAt: ms(1999) }));
  await store.setMessageTime("s-order", "u2", ms(2000));
  await store.saveChatMessage(m("a2", "claude", { createdAt: ms(3000) }));
  const order = (await store.getChatMessages("s-order")).map((x) => x.id);
  assert.deepEqual(order, ["u1", "a1", "u2", "a2"]);
});
