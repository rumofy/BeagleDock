const { t } = require("./i18n");
// Terminal mode: what happens in the CLI's interface also goes into BeagleDock's history. The
// terminal screen isn't the source (colors, cursor, redraws); the source is the conversation file
// the CLI itself saves (the same one Ctrl+H history already imports). At the end of each reply, when
// the terminal closes and when the CLI exits, the new messages in that file become conversation messages.
//
// Only what came after the terminal opened counts: what was already in the file came from the chat and is
// already in the database. A new conversation opened straight in the terminal has no native ID yet: Claude Code
// gets one (`--session-id`); in Codex and AGY, the created conversation is found by folder and time.

const dbTime = (ms) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");
const PROVIDER_NAMES = { claude: "Claude Code", codex: "Codex CLI", antigravity: "Antigravity" };
// Slack between opening the terminal and the CLI saving the start of the conversation (clocks, rounding).
const DISCOVERY_SLACK_MS = 5000;

function createTerminalHistory({
  // (providerId, nativeId, cwd) => { messages: [{ id, sender, text, modelBadge, timestamp }] }
  readConversation,
  // ({ exclude }) => [{ provider, sessionId, project, timestampMs }] (CLI-only conversations)
  listNative,
  // () => ["provider:nativeId", ...] (already linked to BeagleDock conversations)
  linkedIds = async () => [],
  store,
  emit = () => {},
  now = Date.now,
}) {
  const entries = new Map();

  async function read(providerId, nativeId, cwd) {
    try {
      const conversation = await readConversation(providerId, nativeId, cwd);
      return Array.isArray(conversation?.messages) ? conversation.messages : null;
    } catch {
      return null;
    }
  }

  /** The conversation's terminal opened: keep what already existed so it isn't imported again. */
  async function begin({ sessionId, providerId, cwd, nativeId, newNativeId }) {
    const entry = {
      providerId,
      cwd,
      openedAt: now(),
      nativeId: nativeId || null,
      // Claude Code: the ID chosen at opening only applies once the CLI saves the conversation.
      newNativeId: nativeId ? null : newNativeId || null,
      baseline: new Set(),
      saved: new Set(),
      chain: Promise.resolve(),
    };
    entries.set(sessionId, entry);
    // A sync requested before the initial snapshot is ready waits for it: without that, what
    // came from the chat would be imported again.
    entry.chain = (async () => {
      if (!entry.nativeId) return;
      const messages = await read(providerId, entry.nativeId, cwd);
      for (const m of messages || []) entry.baseline.add(m.id);
    })().catch(() => {});
    await entry.chain;
    return entry;
  }

  async function findNativeId(sessionId, entry) {
    if (entry.nativeId) return entry.nativeId;
    let found = null;
    if (entry.newNativeId) {
      if (await read(entry.providerId, entry.newNativeId, entry.cwd)) found = entry.newNativeId;
    } else {
      const exclude = await linkedIds().catch(() => []);
      const items = (await listNative({ exclude }).catch(() => [])) || [];
      found =
        items
          .filter(
            (item) =>
              item.provider === entry.providerId &&
              item.project === entry.cwd &&
              Number.isFinite(item.timestampMs) &&
              item.timestampMs >= entry.openedAt - DISCOVERY_SLACK_MS,
          )
          .sort((a, b) => b.timestampMs - a.timestampMs)[0]?.sessionId || null;
    }
    if (!found) return null;
    // Links the native conversation to BeagleDock's: the chat continues the same conversation afterwards.
    await store.setNativeSession(sessionId, entry.providerId, found, entry.cwd);
    entry.nativeId = found;
    return found;
  }

  async function run(sessionId) {
    const entry = entries.get(sessionId);
    if (!entry) return { added: 0 };
    if (store.sessionExists && !(await store.sessionExists(sessionId))) return { added: 0 };
    const nativeId = await findNativeId(sessionId, entry).catch(() => null);
    if (!nativeId) return { added: 0 };
    const messages = (await read(entry.providerId, nativeId, entry.cwd)) || [];
    const fresh = messages.filter((m) => !entry.baseline.has(m.id) && !entry.saved.has(m.id));
    let lastReply = "";
    for (const m of fresh) {
      const parsed = Date.parse(m.timestamp);
      const at = Number.isFinite(parsed) ? parsed : now();
      const user = m.sender === "user";
      await store.saveChatMessage({
        id: `term-${m.id}`,
        sessionId,
        provider: entry.providerId,
        sender: user ? "user" : entry.providerId,
        senderName: user ? t("profile.you") : PROVIDER_NAMES[entry.providerId] || entry.providerId,
        text: String(m.text || ""),
        modelBadge: user ? undefined : m.modelBadge || undefined,
        timestamp: new Date(at).toISOString(),
        createdAt: dbTime(at),
      });
      entry.saved.add(m.id);
      if (!user && m.text) lastReply = String(m.text);
    }
    if (fresh.length) emit("cli-terminal-history", { sessionId, added: fresh.length });
    return { added: fresh.length, lastReply, nativeId };
  }

  /** Saves the new messages of the native conversation; one sync at a time per conversation. */
  function sync(sessionId) {
    const entry = entries.get(sessionId);
    if (!entry) return Promise.resolve({ added: 0 });
    const next = entry.chain.then(() => run(sessionId));
    entry.chain = next.catch(() => {});
    return next.catch(() => ({ added: 0 }));
  }

  /** The terminal closed or the CLI exited: the last sync and the end of tracking. */
  async function end(sessionId) {
    const entry = entries.get(sessionId);
    const result = await sync(sessionId);
    // Reopened while syncing: the new tracking continues.
    if (entries.get(sessionId) === entry) entries.delete(sessionId);
    return result;
  }

  return { begin, sync, end, has: (sessionId) => entries.has(sessionId) };
}

module.exports = { createTerminalHistory };
