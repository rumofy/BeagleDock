const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const os = require("os");
const fs = require("fs");
const { t } = require("./i18n");
const {
  protectSettings,
  publicSettings,
  dropUnreadableSecrets,
  revealSecret,
  SECRET_KEYS,
} = require("./secure-settings");
const {
  toStoredAttachments,
  fromStoredAttachments,
  removeSessionAttachments,
} = require("./attachments");
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
      "CREATE TRIGGER IF NOT EXISTS chat_requires_session BEFORE INSERT ON chat_history WHEN NOT EXISTS (SELECT 1 FROM sessions WHERE id=NEW.session_id) BEGIN SELECT RAISE(ABORT,'Conversation does not exist or was removed.'); END",
    );
    await run(
      "CREATE TRIGGER IF NOT EXISTS link_requires_session BEFORE INSERT ON session_links WHEN NOT EXISTS (SELECT 1 FROM sessions WHERE id=NEW.session_id) BEGIN SELECT RAISE(ABORT,'Conversation does not exist or was removed.'); END",
    );
    for (const [table, columns] of Object.entries({
      sessions: ["permission_before_plan", "permission", "archived", "context_json", "title_locked", "cwd_locked"],
      chat_history: [
        "model_badge",
        "reasoning_badge",
        "command_snippet",
        "attachments_json",
        "events_json",
      ],
    })) {
      const existing = new Set(
        (await all(`PRAGMA table_info(${table})`)).map((r) => r.name),
      );
      for (const column of columns)
        if (!existing.has(column))
          await run(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    }
    await run(
      "CREATE INDEX IF NOT EXISTS chat_history_session ON chat_history(session_id, created_at)",
    );
    // Native links retain the folder where the conversation actually started. Older terminal
    // sessions could change the displayed folder before the CLI's ID reached the renderer.
    await run("UPDATE sessions SET cwd=(SELECT l.cwd FROM session_links l WHERE l.session_id=sessions.id),cwd_locked='1' WHERE EXISTS (SELECT 1 FROM session_links l WHERE l.session_id=sessions.id AND l.provider_id=sessions.provider_id AND l.cwd<>'')");
    await moveInlineAttachments();
  })();
  return ready;
}
// Old databases kept images as base64 inside the message: they move to files in the conversation's
// folder (just once) and the freed space goes back to the disk.
async function moveInlineAttachments() {
  const rows = await all(
    "SELECT id, session_id, attachments_json FROM chat_history WHERE attachments_json LIKE '%data:%'",
  );
  let moved = 0;
  for (const row of rows) {
    try {
      const stored = toStoredAttachments({
        root: dbDir,
        sessionId: row.session_id,
        attachments: JSON.parse(row.attachments_json),
      });
      await run("UPDATE chat_history SET attachments_json=? WHERE id=?", [
        JSON.stringify(stored),
        row.id,
      ]);
      moved += 1;
    } catch {}
  }
  if (moved) await run("VACUUM");
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
    throw new Error(t("errors.invalidSession"));
  const previous = await get("SELECT provider_id,permission,permission_before_plan,cwd,cwd_locked FROM sessions WHERE id=?", [
    s.id,
  ]);
  if (previous && previous.provider_id !== s.providerId)
    throw new Error(t("errors.providerImmutable"));
  if (previous?.cwd_locked === "1" && previous.cwd !== s.cwd)
    throw new Error(t("errors.newSessionForCwd"));
  const link = await getNativeSession(s.id, s.providerId);
  if (s.nativeSessionId && !/^[a-zA-Z0-9_-]{8,160}$/.test(s.nativeSessionId))
    throw new Error(t("errors.invalidNativeId"));
  if (link && s.nativeSessionId && link.nativeId !== s.nativeSessionId)
    throw new Error(t("errors.nativeIdTaken"));
  if (link && link.cwd !== s.cwd)
    throw new Error(t("errors.newSessionForCwd"));
  const permission = s.permission || "inherit";
  const beforePlan = permission === "plan"
    ? previous?.permission === "plan" ? previous.permission_before_plan : previous?.permission || s.permissionBeforePlan
    : null;
  const validBeforePlan = ["inherit", "ask", "edits", "full"].includes(beforePlan) ? beforePlan : null;
  const saved = await run(
    "INSERT INTO sessions (id,provider_id,title,current_model,reasoning_effort,status,pid,cwd,created_at,last_active,permission,permission_before_plan,title_locked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title_locked=COALESCE(excluded.title_locked,sessions.title_locked),title=excluded.title,current_model=excluded.current_model,reasoning_effort=excluded.reasoning_effort,status=excluded.status,pid=excluded.pid,cwd=excluded.cwd,last_active=excluded.last_active,permission=excluded.permission,permission_before_plan=excluded.permission_before_plan,updated_ts=CURRENT_TIMESTAMP WHERE sessions.cwd_locked IS NOT '1' OR sessions.cwd=excluded.cwd",
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
      permission,
      validBeforePlan,
      s.titleLocked ? "1" : null,
    ],
  );
  if (!saved.changes) throw new Error(t("errors.newSessionForCwd"));
  if (s.nativeSessionId)
    await setNativeSession(s.id, s.providerId, s.nativeSessionId, s.cwd);
  return { success: true, id: s.id };
}
async function getSessionPermission(sessionId) {
  await initDatabase();
  const row = await get("SELECT permission,permission_before_plan FROM sessions WHERE id=?", [sessionId]);
  return row ? { permission: row.permission || "inherit", permissionBeforePlan: row.permission_before_plan || undefined } : undefined;
}
async function getNativeSession(sessionId, providerId) {
  await initDatabase();
  const row = await get("SELECT * FROM session_links WHERE session_id=?", [
    sessionId,
  ]);
  if (row && row.provider_id !== providerId)
    throw new Error(t("errors.providerMismatch"));
  return row ? { nativeId: row.native_id, cwd: row.cwd } : null;
}
/** Claim the saved project before starting a native CLI, including the time before its ID is known. */
async function lockSessionCwd(sessionId, providerId, cwd) {
  await initDatabase();
  const result = await run("UPDATE sessions SET cwd_locked='1' WHERE id=? AND provider_id=? AND cwd=?", [sessionId, providerId, cwd]);
  if (!result.changes) {
    if (!(await sessionExists(sessionId))) throw new Error(t("session.missing"));
    throw new Error(t("errors.otherDirectory"));
  }
}
async function setNativeSession(sessionId, providerId, nativeId, cwd) {
  await initDatabase();
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(nativeId))
    throw new Error(t("errors.invalidNativeId"));
  const existing = await getNativeSession(sessionId, providerId);
  if (existing && (existing.nativeId !== nativeId || existing.cwd !== cwd))
    throw new Error(
      t("errors.conversationLinkedElsewhere"),
    );
  await lockSessionCwd(sessionId, providerId, cwd);
  await run(
    "INSERT INTO session_links(session_id,provider_id,native_id,cwd) VALUES (?,?,?,?) ON CONFLICT(session_id) DO NOTHING",
    [sessionId, providerId, nativeId, cwd],
  );
}
function parseContext(json) {
  try {
    const c = JSON.parse(json || "null");
    return c && Number.isFinite(c.used)
      ? {
          used: c.used,
          window: Number.isFinite(c.window) ? c.window : null,
          windowKnown: !!c.windowKnown,
          source: typeof c.source === "string" ? c.source : undefined,
          compactions: Number.isFinite(c.compactions) ? c.compactions : 0,
          lastCompaction:
            c.lastCompaction && typeof c.lastCompaction === "object"
              ? c.lastCompaction
              : undefined,
          updatedAt: Number.isFinite(c.updatedAt) ? c.updatedAt : undefined,
          cache: c.cache && typeof c.cache === "object" ? c.cache : undefined,
          lastCallAt: Number.isFinite(c.lastCallAt) ? c.lastCallAt : undefined,
          cacheTtlMs: Number.isFinite(c.cacheTtlMs) ? c.cacheTtlMs : undefined,
          model: typeof c.model === "string" ? c.model : undefined,
        }
      : undefined;
  } catch {
    return undefined;
  }
}
// Last known context of the conversation, so the bar shows when the app reopens.
async function setSessionContext(id, context) {
  await initDatabase();
  if (!context || !Number.isFinite(context.used)) return { success: false };
  await run("UPDATE sessions SET context_json=? WHERE id=?", [
    JSON.stringify({
      used: context.used,
      window: Number.isFinite(context.window) ? context.window : null,
      windowKnown: !!context.windowKnown,
      source: context.source,
      compactions: context.compactions || 0,
      lastCompaction: context.lastCompaction,
      updatedAt: context.updatedAt,
      cache: context.cache,
      lastCallAt: context.lastCallAt,
      cacheTtlMs: context.cacheTtlMs,
      model: typeof context.model === "string" ? context.model : undefined,
    }),
    id,
  ]);
  return { success: true };
}
async function setSessionArchived(id, archived) {
  await initDatabase();
  const result = await run("UPDATE sessions SET archived=? WHERE id=?", [
    archived ? "1" : null,
    id,
  ]);
  if (!result.changes) throw new Error(t("session.missing"));
  return { success: true, id, archived: !!archived };
}
async function deleteSessionFromDb(id) {
  await initDatabase();
  await run("DELETE FROM sessions WHERE id=?", [id]);
  removeSessionAttachments({ root: dbDir, sessionId: id });
  return { success: true };
}
// Save time in SQLite (UTC without a time zone) or ISO coming from the interface.
function sqlTime(value) {
  if (!value) return NaN;
  const text = String(value);
  return Date.parse(/[TZ+]/.test(text.slice(10)) ? text : text.replace(" ", "T") + "Z");
}
const likeEscape = (text) => text.replace(/[\\%_]/g, (c) => "\\" + c);
/**
 * BeagleDock conversations for the history: only the list data (messages load when opened).
 * The search looks in the title and in the message text.
 */
async function listConversationHistory(query = "") {
  await initDatabase();
  const term = typeof query === "string" ? query.trim().slice(0, 200) : "";
  const like = `%${likeEscape(term)}%`;
  const rows = await all(
    `SELECT s.id, s.provider_id, s.title, s.cwd, s.current_model, s.archived, s.updated_ts, l.native_id,
       (SELECT MAX(created_at) FROM chat_history c WHERE c.session_id=s.id) AS last_message,
       (SELECT COUNT(*) FROM chat_history c WHERE c.session_id=s.id) AS message_count,
       (SELECT text FROM chat_history c WHERE c.session_id=s.id AND c.sender='user' ORDER BY created_at,rowid LIMIT 1) AS first_prompt
     FROM sessions s LEFT JOIN session_links l ON l.session_id=s.id
     ${term ? "WHERE s.title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM chat_history c WHERE c.session_id=s.id AND c.text LIKE ? ESCAPE '\\')" : ""}`,
    term ? [like, like] : [],
  );
  return rows
    .map((r) => {
      const ts = sqlTime(r.last_message) || sqlTime(r.updated_ts) || 0;
      return {
        id: `beagledock:${r.id}`,
        source: "beagledock",
        provider: r.provider_id,
        title: r.title || "Conversa",
        prompt: r.first_prompt || "",
        project: r.cwd || "",
        timestampMs: ts,
        date: new Date(ts).toLocaleString(),
        beagleSessionId: r.id,
        sessionId: r.native_id || undefined,
        model: r.current_model || "",
        closed: r.archived === "1",
        messageCount: r.message_count || 0,
      };
    })
    .sort((a, b) => b.timestampMs - a.timestampMs);
}
/** Native IDs already linked to BeagleDock conversations (the history doesn't repeat them). */
async function linkedNativeIds() {
  await initDatabase();
  return (await all("SELECT provider_id, native_id FROM session_links")).map(
    (r) => `${r.provider_id}:${r.native_id}`,
  );
}
async function getSavedSessions() {
  await initDatabase();
  return (
    await all(
      "SELECT s.*,l.native_id,(SELECT MAX(created_at) FROM chat_history c WHERE c.session_id=s.id) AS last_message FROM sessions s LEFT JOIN session_links l ON l.session_id=s.id ORDER BY s.updated_ts DESC",
    )
  ).map((r) => ({
    id: r.id,
    providerId: r.provider_id,
    title: r.title,
    currentModel: r.current_model || "",
    reasoningEffort: r.reasoning_effort || "",
    status: "idle",
    cwd: r.cwd,
    cwdLocked: r.cwd_locked === "1",
    createdAt: r.created_at,
    lastActive: r.last_active,
    permission: r.permission || "edits",
    permissionBeforePlan: r.permission_before_plan || undefined,
    archived: r.archived === "1",
    titleLocked: r.title_locked === "1",
    context: parseContext(r.context_json),
    nativeSessionId: r.native_id || undefined,
    // Sidebar sort key: last message, or the last save for a conversation without messages yet.
    lastMessageAt: sqlTime(r.last_message) || sqlTime(r.updated_ts) || 0,
    ptyLog: [],
  }));
}
const insertMessageSql =
  "INSERT INTO chat_history (id,session_id,provider,sender,sender_name,model_badge,reasoning_badge,text,command_snippet,attachments_json,timestamp,events_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP))";
const messageSql =
  insertMessageSql +
  " ON CONFLICT(id) DO UPDATE SET text=excluded.text,model_badge=excluded.model_badge,reasoning_badge=excluded.reasoning_badge,events_json=COALESCE(excluded.events_json,chat_history.events_json)";
const MAX_EVENTS_JSON = 512 * 1024;
const META_NUMBERS = ["tokens", "toolUses", "durationMs", "threads"];
const META_STRINGS = ["taskId", "subagentType", "lastTool", "model", "note"];
// A proposed plan (meta.proposal) keeps its full text in the history.
const MAX_PLAN_TEXT = 60000;
function cleanMeta(meta) {
  if (!meta || typeof meta !== "object") return undefined;
  const out = {};
  for (const key of META_NUMBERS)
    if (Number.isFinite(meta[key])) out[key] = meta[key];
  for (const key of META_STRINGS)
    if (typeof meta[key] === "string" && meta[key])
      out[key] = meta[key].slice(0, key === "note" ? 200 : 120);
  if (meta.background === true) out.background = true;
  if (meta.proposal === true) out.proposal = true;
  return Object.keys(out).length ? out : undefined;
}
function eventsJson(events) {
  if (!Array.isArray(events) || !events.length) return null;
  const clean = events
    .filter((e) => e && typeof e === "object")
    .slice(0, 300)
    .map((e) => ({
      id: String(e.id),
      parentId: e.parentId ? String(e.parentId).slice(0, 200) : undefined,
      meta: cleanMeta(e.meta),
      kind: String(e.kind || "status"),
      title: String(e.title || "").slice(0, 200),
      detail: e.detail ? String(e.detail).slice(0, 400) : undefined,
      text: e.text
        ? String(e.text).slice(0, e.meta?.proposal === true ? MAX_PLAN_TEXT : 4000)
        : undefined,
      status: ["running", "done", "error"].includes(e.status)
        ? e.status
        : "done",
      startedAt: Number.isFinite(e.startedAt) ? e.startedAt : undefined,
      endedAt: Number.isFinite(e.endedAt) ? e.endedAt : undefined,
      durationMs: Number.isFinite(e.durationMs) ? e.durationMs : undefined,
      exitCode: Number.isFinite(e.exitCode) ? e.exitCode : undefined,
    }));
  let json = JSON.stringify(clean);
  if (json.length > MAX_EVENTS_JSON)
    json = JSON.stringify(clean.map(({ text, ...rest }) => rest));
  return json.length > MAX_EVENTS_JSON ? null : json;
}
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
    m.attachments
      ? JSON.stringify(
          toStoredAttachments({
            root: dbDir,
            sessionId: m.sessionId,
            attachments: m.attachments,
          }),
        )
      : null,
    m.timestamp,
    eventsJson(m.events),
    typeof m.createdAt === "string" ? m.createdAt : null,
  ];
}
// Repositions a message in the history (a message delivered in the middle of a reply in progress).
async function setMessageTime(sessionId, messageId, createdAt) {
  await initDatabase();
  await run("UPDATE chat_history SET created_at=? WHERE id=? AND session_id=?", [
    createdAt,
    messageId,
    sessionId,
  ]);
  return { success: true };
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
    throw new Error(t("errors.invalidHistory"));
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
      throw new Error(t("session.missing"));
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
// Late update of a reply (background agent): merges by id with what was already
// saved, without erasing the rest of the timeline.
async function mergeMessageEvents(sessionId, messageId, events) {
  await initDatabase();
  const row = await get(
    "SELECT events_json FROM chat_history WHERE id=? AND session_id=?",
    [messageId, sessionId],
  );
  if (!row) return { success: false };
  let existing = [];
  try {
    existing = JSON.parse(row.events_json || "[]") || [];
  } catch {}
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const event of Array.isArray(events) ? events : [])
    if (event && typeof event === "object" && event.id)
      byId.set(String(event.id), event);
  const merged = [...byId.values()];
  trackLive(messageId, merged);
  const json = eventsJson(merged);
  if (!json) return { success: false };
  await run(
    "UPDATE chat_history SET events_json=? WHERE id=? AND session_id=?",
    [json, messageId, sessionId],
  );
  return { success: true };
}
function trackLive(messageId, events) {
  if (Array.isArray(events) && events.some((e) => e && e.status === "running"))
    LIVE_MESSAGE_IDS.add(messageId);
  else LIVE_MESSAGE_IDS.delete(messageId);
}
async function saveChatMessage(m) {
  await initDatabase();
  trackLive(m.id, m.events);
  await run(messageSql, messageParams(m));
  return { success: true, id: m.id };
}
async function deleteChatMessage(sessionId, messageId) {
  await initDatabase();
  await run("DELETE FROM chat_history WHERE id=? AND session_id=?", [messageId, sessionId]);
  LIVE_MESSAGE_IDS.delete(messageId);
  return { success: true };
}
// Replies with background agents still active in this run of the app.
const LIVE_MESSAGE_IDS = new Set();
function chatRow(r) {
  let attachments;
  try {
    attachments =
      fromStoredAttachments({
        root: dbDir,
        sessionId: r.session_id,
        attachments: JSON.parse(r.attachments_json || "null"),
      }) || undefined;
  } catch {}
  let events;
  try {
    events = JSON.parse(r.events_json || "null") || undefined;
    // "Running" in the history is from a previous run of the app: the real outcome is unknown.
    if (events && !LIVE_MESSAGE_IDS.has(r.id))
      events = events.map((e) =>
        e.status === "running"
          ? {
              ...e,
              status: "done",
              meta: {
                ...e.meta,
                note: t("activity.unknownOutcome"),
              },
            }
          : e,
      );
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
    events,
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
// Only open conversations load their messages at startup; closed ones load when reopened.
async function getAllChatMessagesGrouped() {
  await initDatabase();
  const grouped = {};
  for (const row of await all(
    "SELECT c.* FROM chat_history c JOIN sessions s ON s.id=c.session_id WHERE s.archived IS NULL OR s.archived<>'1' ORDER BY c.created_at,c.rowid",
  ))
    (grouped[row.session_id] ||= []).push(chatRow(row));
  return grouped;
}
async function saveWorkspace(ws) {
  await initDatabase();
  await run(
    "INSERT INTO workspaces (id,name,path,has_ai_memory,ai_memory_daemon) VALUES (?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET name=excluded.name,has_ai_memory=excluded.has_ai_memory,ai_memory_daemon=excluded.ai_memory_daemon,last_accessed=CURRENT_TIMESTAMP",
    [ws.id, ws.name, ws.path, ws.hasAIMemory ? 1 : 0, 0],
  );
  return { success: true, workspace: ws };
}
// Maintenance: only touches the registry. Conversations keep their own folder (cwd) and the link to the CLI's
// native session, so editing or removing a workspace never changes or deletes conversations.
async function updateWorkspace(id, { name, path: dir, hasAIMemory }) {
  await initDatabase();
  const current = await get("SELECT id FROM workspaces WHERE id=?", [id]);
  if (!current) throw new Error(t("errors.workspaceNotFound"));
  const clash = await get("SELECT id FROM workspaces WHERE path=? AND id<>?", [dir, id]);
  if (clash) throw new Error(t("errors.workspaceFolderTaken"));
  await run(
    "UPDATE workspaces SET name=?,path=?,has_ai_memory=? WHERE id=?",
    [name, dir, hasAIMemory ? 1 : 0, id],
  );
  return { id, name, path: dir, hasAIMemory: !!hasAIMemory };
}
async function deleteWorkspace(id) {
  await initDatabase();
  const result = await run("DELETE FROM workspaces WHERE id=?", [id]);
  return { success: true, removed: (result?.changes ?? 1) > 0 };
}
async function workspaceSessionCounts() {
  await initDatabase();
  const counts = {};
  for (const row of await all(
    "SELECT cwd, COUNT(*) AS total FROM sessions GROUP BY cwd",
  ))
    counts[row.cwd] = row.total;
  return counts;
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
// Discards credentials the current keyring can't decrypt (e.g. the app's identity changed).
async function dropUnreadableCredentials(storage) {
  await initDatabase();
  const current = await rawSettings();
  const { settings, dropped } = dropUnreadableSecrets(current, storage);
  if (dropped.length) await writeSettings(settings);
  return dropped;
}
// Plain credential for the main process (never goes to the renderer).
async function getSecret(key) {
  if (!SECRET_KEYS.includes(key)) throw new Error(t("errors.unknownCredential"));
  await initDatabase();
  return revealSecret((await rawSettings())[key]);
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
        t("errors.plainCredentials"),
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
  setSessionArchived,
  setSessionContext,
  getSavedSessions,
  getSessionPermission,
  getNativeSession,
  lockSessionCwd,
  setNativeSession,
  deleteSessionFromDb,
  listConversationHistory,
  linkedNativeIds,
  saveChatMessage,
  setMessageTime,
  deleteChatMessage,
  mergeMessageEvents,
  replaceChatMessages,
  sessionExists,
  getChatMessages,
  getAllChatMessagesGrouped,
  saveWorkspace,
  updateWorkspace,
  deleteWorkspace,
  workspaceSessionCounts,
  getWorkspaces,
  saveAppSettings,
  getAppSettings,
  getSecret,
  dropUnreadableCredentials,
};
