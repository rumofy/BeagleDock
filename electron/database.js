const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const os = require("os");
const fs = require("fs");
const {
  protectSettings,
  publicSettings,
  dropUnreadableSecrets,
} = require("./secure-settings");
const dbDir =
  process.env.BEAGLEDOCK_DATA_DIR || path.join(os.homedir(), ".beagledock");
fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
const dbPath = path.join(dbDir, "beagledock.db");
const db = new sqlite3.Database(dbPath);
try {
  fs.chmodSync(dbPath, 0o600);
} catch {}
const run = (sql, args = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, args, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    }),
  );
const all = (sql, args = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, args, (err, rows) => (err ? reject(err) : resolve(rows))),
  );
const get = (sql, args = []) =>
  new Promise((resolve, reject) =>
    db.get(sql, args, (err, row) => (err ? reject(err) : resolve(row))),
  );
let ready;
function initDatabase() {
  if (ready) return ready;
  ready = (async () => {
    await run("PRAGMA busy_timeout = 5000");
    await run("PRAGMA secure_delete = ON");
    await run(
      "CREATE TABLE IF NOT EXISTS user_profile (id TEXT PRIMARY KEY, full_name TEXT, first_name TEXT, email TEXT, initials TEXT, updated_at TEXT)",
    );
    await run(
      "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, provider_id TEXT, title TEXT, current_model TEXT, reasoning_effort TEXT, status TEXT, pid INTEGER, cwd TEXT, created_at TEXT, last_active TEXT, permission TEXT, updated_ts TEXT DEFAULT CURRENT_TIMESTAMP)",
    );
    await run(
      "CREATE TABLE IF NOT EXISTS chat_history (id TEXT PRIMARY KEY, session_id TEXT, provider TEXT, sender TEXT, sender_name TEXT, model_badge TEXT, reasoning_badge TEXT, text TEXT, command_snippet TEXT, attachments_json TEXT, timestamp TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    );
    await run(
      "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT, path TEXT UNIQUE, has_ai_memory INTEGER DEFAULT 0, ai_memory_daemon INTEGER DEFAULT 0, last_accessed TEXT DEFAULT CURRENT_TIMESTAMP)",
    );
    await run(
      "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    );
    await run(
      "CREATE TABLE IF NOT EXISTS session_links (session_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, native_id TEXT NOT NULL, cwd TEXT NOT NULL)",
    );
    // These guards also migrate old databases without rebuilding their tables.
    await run(
      "DELETE FROM chat_history WHERE NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.id=chat_history.session_id)",
    );
    await run(
      "DELETE FROM session_links WHERE NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.id=session_links.session_id)",
    );
    await run(
      "CREATE TRIGGER IF NOT EXISTS session_delete_children AFTER DELETE ON sessions BEGIN DELETE FROM chat_history WHERE session_id=OLD.id; DELETE FROM session_links WHERE session_id=OLD.id; END",
    );
    await run(
      "CREATE TRIGGER IF NOT EXISTS chat_requires_session BEFORE INSERT ON chat_history WHEN NOT EXISTS (SELECT 1 FROM sessions WHERE id=NEW.session_id) BEGIN SELECT RAISE(ABORT,'Conversa inexistente ou removida.'); END",
    );
    await run(
      "CREATE TRIGGER IF NOT EXISTS link_requires_session BEFORE INSERT ON session_links WHEN NOT EXISTS (SELECT 1 FROM sessions WHERE id=NEW.session_id) BEGIN SELECT RAISE(ABORT,'Conversa inexistente ou removida.'); END",
    );
    for (const [table, columns] of Object.entries({
      sessions: ["permission"],
      chat_history: [
        "model_badge",
        "reasoning_badge",
        "command_snippet",
        "attachments_json",
      ],
    })) {
      const existing = new Set(
        (await all(`PRAGMA table_info(${table})`)).map((r) => r.name),
      );
      for (const column of columns)
        if (!existing.has(column))
          await run(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    }
  })();
  return ready;
}
async function saveUserProfile(profile) {
  await initDatabase();
  await run(
    "INSERT INTO user_profile (id,full_name,first_name,email,initials,updated_at) VALUES ('current_user',?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name,first_name=excluded.first_name,email=excluded.email,initials=excluded.initials,updated_at=CURRENT_TIMESTAMP",
    [profile.fullName, profile.firstName, profile.email, profile.initials],
  );
  return profile;
}
async function getUserProfile() {
  await initDatabase();
  return get("SELECT * FROM user_profile WHERE id='current_user'");
}
async function saveSession(s) {
  await initDatabase();
  if (
    !s ||
    typeof s.id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,200}$/.test(s.id) ||
    !["claude", "codex", "antigravity"].includes(s.providerId)
  )
    throw new Error("Sessão inválida.");
  const previous = await get("SELECT provider_id FROM sessions WHERE id=?", [
    s.id,
  ]);
  if (previous && previous.provider_id !== s.providerId)
    throw new Error("O provedor de uma conversa não pode ser alterado.");
  const link = await getNativeSession(s.id, s.providerId);
  if (s.nativeSessionId && !/^[a-zA-Z0-9_-]{8,160}$/.test(s.nativeSessionId))
    throw new Error("ID nativo inválido.");
  if (link && s.nativeSessionId && link.nativeId !== s.nativeSessionId)
    throw new Error("Esta conversa já possui outro ID nativo.");
  if (link && link.cwd !== s.cwd)
    throw new Error("Crie uma nova sessão para trocar de diretório.");
  await run(
    "INSERT INTO sessions (id,provider_id,title,current_model,reasoning_effort,status,pid,cwd,created_at,last_active,permission) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,current_model=excluded.current_model,reasoning_effort=excluded.reasoning_effort,status=excluded.status,pid=excluded.pid,cwd=excluded.cwd,last_active=excluded.last_active,permission=excluded.permission,updated_ts=CURRENT_TIMESTAMP",
    [
      s.id,
      s.providerId,
      s.title,
      s.currentModel,
      s.reasoningEffort,
      s.status || "idle",
      s.pid || null,
      s.cwd || os.homedir(),
      s.createdAt || new Date().toISOString(),
      s.lastActive || "",
      s.permission || "inherit",
    ],
  );
  if (s.nativeSessionId)
    await setNativeSession(s.id, s.providerId, s.nativeSessionId, s.cwd);
  return { success: true, id: s.id };
}
async function getNativeSession(sessionId, providerId) {
  await initDatabase();
  const row = await get("SELECT * FROM session_links WHERE session_id=?", [
    sessionId,
  ]);
  if (row && row.provider_id !== providerId)
    throw new Error("Provedor incompatível com a conversa salva.");
  return row ? { nativeId: row.native_id, cwd: row.cwd } : null;
}
async function setNativeSession(sessionId, providerId, nativeId, cwd) {
  await initDatabase();
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(nativeId))
    throw new Error("ID nativo inválido.");
  const existing = await getNativeSession(sessionId, providerId);
  if (existing && (existing.nativeId !== nativeId || existing.cwd !== cwd))
    throw new Error(
      "A conversa já está associada a outra sessão ou diretório.",
    );
  await run(
    "INSERT INTO session_links(session_id,provider_id,native_id,cwd) VALUES (?,?,?,?) ON CONFLICT(session_id) DO NOTHING",
    [sessionId, providerId, nativeId, cwd],
  );
}
async function deleteSessionFromDb(id) {
  await initDatabase();
  await run("DELETE FROM sessions WHERE id=?", [id]);
  return { success: true };
}
async function getSavedSessions() {
  await initDatabase();
  return (
    await all(
      "SELECT s.*,l.native_id FROM sessions s LEFT JOIN session_links l ON l.session_id=s.id ORDER BY s.updated_ts DESC",
    )
  ).map((r) => ({
    id: r.id,
    providerId: r.provider_id,
    title: r.title,
    currentModel: r.current_model || "",
    reasoningEffort: r.reasoning_effort || "",
    status: "idle",
    cwd: r.cwd,
    createdAt: r.created_at,
    lastActive: r.last_active,
    permission: r.permission || "edits",
    nativeSessionId: r.native_id || undefined,
    ptyLog: [],
  }));
}
const insertMessageSql =
  "INSERT INTO chat_history (id,session_id,provider,sender,sender_name,model_badge,reasoning_badge,text,command_snippet,attachments_json,timestamp) VALUES (?,?,?,?,?,?,?,?,?,?,?)";
const messageSql =
  insertMessageSql +
  " ON CONFLICT(id) DO UPDATE SET text=excluded.text,model_badge=excluded.model_badge,reasoning_badge=excluded.reasoning_badge";
function messageParams(m) {
  return [
    m.id,
    m.sessionId,
    m.provider || "",
    m.sender,
    m.senderName,
    m.modelBadge || null,
    m.reasoningBadge || null,
    m.text,
    m.commandSnippet || null,
    m.attachments ? JSON.stringify(m.attachments) : null,
    m.timestamp,
  ];
}
async function sessionExists(id) {
  await initDatabase();
  return !!(await get("SELECT 1 FROM sessions WHERE id=?", [id]));
}
async function replaceChatMessages(id, messages) {
  await initDatabase();
  if (
    !Array.isArray(messages) ||
    messages.some(
      (m) =>
        !m ||
        m.sessionId !== id ||
        typeof m.id !== "string" ||
        typeof m.text !== "string",
    )
  )
    throw new Error("Histórico inválido.");
  // A dedicated connection prevents unrelated writes from joining this transaction.
  const transaction = new sqlite3.Database(dbPath);
  const txRun = (sql, args = []) =>
    new Promise((resolve, reject) =>
      transaction.run(sql, args, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
  const txGet = (sql, args = []) =>
    new Promise((resolve, reject) =>
      transaction.get(sql, args, (error, row) =>
        error ? reject(error) : resolve(row),
      ),
    );
  let started = false;
  try {
    await txRun("PRAGMA busy_timeout=5000");
    await txRun("PRAGMA secure_delete=ON");
    await txRun("BEGIN IMMEDIATE");
    started = true;
    if (!(await txGet("SELECT 1 FROM sessions WHERE id=?", [id])))
      throw new Error("Conversa inexistente ou removida.");
    await txRun("DELETE FROM chat_history WHERE session_id=?", [id]);
    for (const message of messages)
      await txRun(insertMessageSql, messageParams(message));
    await txRun("COMMIT");
    started = false;
    return { success: true };
  } catch (error) {
    if (started) await txRun("ROLLBACK");
    throw error;
  } finally {
    await new Promise((resolve, reject) =>
      transaction.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
async function saveChatMessage(m) {
  await initDatabase();
  await run(messageSql, messageParams(m));
  return { success: true, id: m.id };
}
function chatRow(r) {
  let attachments;
  try {
    attachments = JSON.parse(r.attachments_json || "null") || undefined;
  } catch {}
  return {
    id: r.id,
    sessionId: r.session_id,
    sender: r.sender,
    senderName: r.sender_name,
    modelBadge: r.model_badge || undefined,
    reasoningBadge: r.reasoning_badge || undefined,
    text: r.text,
    commandSnippet: r.command_snippet || undefined,
    attachments,
    timestamp: r.timestamp,
  };
}
async function getChatMessages(id) {
  await initDatabase();
  return (
    await all(
      "SELECT * FROM chat_history WHERE session_id=? ORDER BY created_at,rowid",
      [id],
    )
  ).map(chatRow);
}
async function getAllChatMessagesGrouped() {
  await initDatabase();
  const grouped = {};
  for (const row of await all(
    "SELECT * FROM chat_history ORDER BY created_at,rowid",
  ))
    (grouped[row.session_id] ||= []).push(chatRow(row));
  return grouped;
}
async function saveWorkspace(ws) {
  await initDatabase();
  await run(
    "INSERT INTO workspaces (id,name,path,has_ai_memory,ai_memory_daemon) VALUES (?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET name=excluded.name,has_ai_memory=excluded.has_ai_memory,ai_memory_daemon=excluded.ai_memory_daemon,last_accessed=CURRENT_TIMESTAMP",
    [
      ws.id,
      ws.name,
      ws.path,
      ws.hasAIMemory ? 1 : 0,
      0,
    ],
  );
  return { success: true, workspace: ws };
}
async function getWorkspaces() {
  await initDatabase();
  return (
    await all("SELECT * FROM workspaces ORDER BY last_accessed DESC")
  ).map((r) => ({
    id: r.id,
    name: r.name,
    path: r.path,
    hasAIMemory: !!r.has_ai_memory,
  }));
}
async function rawSettings() {
  const row = await get(
    "SELECT value FROM app_settings WHERE key='global_settings'",
  );
  if (!row) return {};
  return JSON.parse(row.value);
}
async function writeSettings(settings) {
  await run(
    "INSERT INTO app_settings(key,value) VALUES ('global_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",
    [JSON.stringify(settings)],
  );
}
let settingsQueue = Promise.resolve();
function saveAppSettings(settings) {
  const operation = settingsQueue.then(async () => {
    await initDatabase();
    const protectedValue = protectSettings(settings, await rawSettings());
    await writeSettings(protectedValue);
    return { success: true, settings: publicSettings(protectedValue) };
  });
  settingsQueue = operation.catch(() => {});
  return operation;
}
// Descarta credenciais que o cofre atual não consegue decifrar (ex.: troca de identidade do app).
async function dropUnreadableCredentials(storage) {
  await initDatabase();
  const current = await rawSettings();
  const { settings, dropped } = dropUnreadableSecrets(current, storage);
  if (dropped.length) await writeSettings(settings);
  return dropped;
}
async function getAppSettings() {
  await initDatabase();
  const current = await rawSettings();
  try {
    const migrated = protectSettings({}, current);
    if (JSON.stringify(migrated) !== JSON.stringify(current)) {
      await writeSettings(migrated);
      await run("VACUUM");
    }
    return publicSettings(migrated);
  } catch {
    return {
      ...publicSettings(current),
      securityWarning:
        "Há credenciais antigas sem criptografia. Abra no aplicativo desktop com o cofre do sistema disponível para migrá-las.",
    };
  }
}
module.exports = {
  db,
  dbPath,
  initDatabase,
  saveUserProfile,
  getUserProfile,
  saveSession,
  getSavedSessions,
  getNativeSession,
  setNativeSession,
  deleteSessionFromDb,
  saveChatMessage,
  replaceChatMessages,
  sessionExists,
  getChatMessages,
  getAllChatMessagesGrouped,
  saveWorkspace,
  getWorkspaces,
  saveAppSettings,
  getAppSettings,
  dropUnreadableCredentials,
};
