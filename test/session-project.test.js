const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-session-project-"));
process.env.BEAGLEDOCK_DATA_DIR = root;
const store = require("../electron/database");
after(async () => {
  await new Promise((resolve, reject) => store.db.close((e) => e ? reject(e) : resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});
const session = (id, providerId, cwd = root) => ({ id, providerId, cwd, title: "Project selection" });

for (const providerId of ["claude", "codex", "antigravity"]) {
  test(`${providerId}: project stays editable before launch and is locked before a native ID exists`, async () => {
    const id = `lock-${providerId}`;
    await store.saveSession(session(id, providerId, "/first"));
    await store.saveSession(session(id, providerId));
    await store.lockSessionCwd(id, providerId, root);
    assert.equal(await store.getNativeSession(id, providerId), null);
    await assert.rejects(store.saveSession(session(id, providerId, "/other")), /new session/);
    await store.saveSession({ ...session(id, providerId), title: "Renamed" });
    const saved = (await store.getSavedSessions()).find((s) => s.id === id);
    assert.equal(saved.cwd, root);
    assert.equal(saved.cwdLocked, true);
    assert.equal(saved.title, "Renamed");
  });

  test(`${providerId}: a simultaneous project save and terminal claim cannot both succeed`, async () => {
    const id = `race-${providerId}`;
    await store.saveSession(session(id, providerId));
    const results = await Promise.allSettled([
      store.saveSession(session(id, providerId, "/other")),
      store.lockSessionCwd(id, providerId, root),
    ]);
    assert.notEqual(results.filter((r) => r.status === "fulfilled").length, 2);
    const saved = (await store.getSavedSessions()).find((s) => s.id === id);
    assert.ok(saved.cwd === root && saved.cwdLocked || saved.cwd === "/other" && !saved.cwdLocked);
  });
}

test("legacy mismatched folders recover from native links without replacing IDs or history", async () => {
  const legacyRoot = path.join(root, "legacy");
  fs.mkdirSync(legacyRoot);
  const sqlite3 = require("sqlite3");
  const legacy = new sqlite3.Database(path.join(legacyRoot, "beagledock.db"));
  const run = (sql, args = []) => new Promise((resolve, reject) => legacy.run(sql, args, (e) => e ? reject(e) : resolve()));
  await run("CREATE TABLE sessions (id TEXT PRIMARY KEY, provider_id TEXT, title TEXT, current_model TEXT, reasoning_effort TEXT, status TEXT, pid INTEGER, cwd TEXT, created_at TEXT, last_active TEXT, permission TEXT, updated_ts TEXT DEFAULT CURRENT_TIMESTAMP)");
  await run("CREATE TABLE chat_history (id TEXT PRIMARY KEY, session_id TEXT, provider TEXT, sender TEXT, sender_name TEXT, model_badge TEXT, reasoning_badge TEXT, text TEXT, command_snippet TEXT, attachments_json TEXT, timestamp TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  await run("CREATE TABLE session_links (session_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, native_id TEXT NOT NULL, cwd TEXT NOT NULL)");
  for (const provider of ["claude", "codex", "antigravity"]) {
    await run("INSERT INTO sessions(id,provider_id,title,cwd) VALUES(?,?,?,?)", [provider, provider, "Preserved", "/incorrect"]);
    await run("INSERT INTO session_links VALUES(?,?,?,?)", [provider, provider, `native-${provider}`, "/original"]);
    await run("INSERT INTO chat_history(id,session_id,sender,text) VALUES(?,?,?,?)", [`message-${provider}`, provider, "user", "Original request"]);
  }
  await new Promise((resolve) => legacy.close(resolve));
  const database = path.resolve("electron/database.js");
  const script = `const s=require(${JSON.stringify(database)});(async()=>{const sessions=await s.getSavedSessions();const messages=await s.getAllChatMessagesGrouped();console.log(JSON.stringify({sessions,messages}));await new Promise(r=>s.db.close(r));})().catch(e=>{console.error(e);process.exit(1)});`;
  const result = JSON.parse(execFileSync(process.execPath, ["-e", script], { env: { ...process.env, BEAGLEDOCK_DATA_DIR: legacyRoot }, encoding: "utf8" }));
  for (const provider of ["claude", "codex", "antigravity"]) {
    const saved = result.sessions.find((s) => s.id === provider);
    assert.equal(saved.cwd, "/original");
    assert.equal(saved.cwdLocked, true);
    assert.equal(saved.nativeSessionId, `native-${provider}`);
    assert.equal(result.messages[provider][0].text, "Original request");
  }
});
