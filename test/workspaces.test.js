const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-workspaces-"));
process.env.BEAGLEDOCK_DATA_DIR = path.join(root, "data");
const store = require("../electron/database");
const { inspectWorkspace, validateWorkspaceEdit } = require("../electron/workspace-status");
const { validCwd } = require("../electron/platform");
after(async () => {
  await new Promise((resolve, reject) => store.db.close((e) => (e ? reject(e) : resolve())));
  fs.rmSync(root, { recursive: true, force: true });
});
const dir = (name, files = []) => {
  const d = path.join(root, name);
  fs.mkdirSync(d, { recursive: true });
  for (const f of files) fs.mkdirSync(path.join(d, f), { recursive: true });
  return d;
};

test("manutenção: renomear e trocar a pasta, sem aceitar pasta de outro workspace nem id inexistente", async () => {
  const a = dir("a"), b = dir("b");
  await store.saveWorkspace({ id: "ws-a", name: "A", path: a, hasAIMemory: false });
  await store.saveWorkspace({ id: "ws-b", name: "B", path: b, hasAIMemory: false });
  const moved = dir("a-movida");
  assert.deepEqual(await store.updateWorkspace("ws-a", { name: "Projeto A", path: moved, hasAIMemory: true }), {
    id: "ws-a", name: "Projeto A", path: moved, hasAIMemory: true,
  });
  const saved = (await store.getWorkspaces()).find((w) => w.id === "ws-a");
  assert.deepEqual([saved.name, saved.path, saved.hasAIMemory], ["Projeto A", moved, true]);
  await assert.rejects(store.updateWorkspace("ws-a", { name: "X", path: b }), /outro workspace com esta pasta/);
  await assert.rejects(store.updateWorkspace("nao-existe", { name: "X", path: a }), /não encontrado/);
  assert.equal((await store.getWorkspaces()).find((w) => w.id === "ws-a").path, moved, "falhas não alteram nada");
});

test("remover o workspace preserva as conversas, o histórico e o vínculo nativo", async () => {
  const proj = dir("proj");
  await store.saveWorkspace({ id: "ws-p", name: "P", path: proj, hasAIMemory: false });
  await store.saveSession({ id: "conv-1", providerId: "claude", cwd: proj, title: "Conversa" });
  await store.saveChatMessage({ id: "m1", sessionId: "conv-1", sender: "user", senderName: "F", text: "oi", timestamp: "t" });
  assert.equal((await store.workspaceSessionCounts())[proj], 1);
  assert.deepEqual(await store.deleteWorkspace("ws-p"), { success: true, removed: true });
  assert.equal((await store.getWorkspaces()).some((w) => w.id === "ws-p"), false);
  assert.equal((await store.getSavedSessions()).filter((s) => s.id === "conv-1").length, 1);
  assert.equal((await store.getChatMessages("conv-1")).length, 1);
  assert.deepEqual(await store.deleteWorkspace("ws-p"), { success: true, removed: false });
});

test("estado do workspace: pasta, git, ai-memory e conversas; pasta sumida é informada", () => {
  const full = dir("full", [".git"]);
  fs.writeFileSync(path.join(full, ".ai-memory.toml"), "");
  assert.deepEqual(
    (({ exists, isGitRepo, hasAIMemory, conversations }) => ({ exists, isGitRepo, hasAIMemory, conversations }))(
      inspectWorkspace({ id: "1", name: "F", path: full, hasAIMemory: false }, { [full]: 3 }),
    ),
    { exists: true, isGitRepo: true, hasAIMemory: true, conversations: 3 },
  );
  const gone = inspectWorkspace({ id: "2", name: "G", path: path.join(root, "sumiu"), hasAIMemory: true });
  assert.deepEqual([gone.exists, gone.isGitRepo, gone.hasAIMemory, gone.conversations], [false, false, false, 0]);
  const file = path.join(root, "arquivo.txt");
  fs.writeFileSync(file, "x");
  assert.equal(inspectWorkspace({ id: "3", name: "F", path: file }).exists, false, "arquivo não é pasta");
});

test("validação da edição: nome obrigatório e limitado, pasta existente e absoluta", () => {
  const ok = dir("ok");
  assert.deepEqual(validateWorkspaceEdit({ name: "  Meu  ", path: ok }, { validCwd }), { name: "Meu", path: ok });
  assert.throws(() => validateWorkspaceEdit({ name: "   ", path: ok }, { validCwd }), /nome/);
  assert.throws(() => validateWorkspaceEdit({ name: "x".repeat(81), path: ok }, { validCwd }), /80/);
  assert.throws(() => validateWorkspaceEdit({ name: "A", path: path.join(root, "nada") }, { validCwd }));
  assert.throws(() => validateWorkspaceEdit({ name: "A", path: "relativo/pasta" }, { validCwd }), /existente/);
});
