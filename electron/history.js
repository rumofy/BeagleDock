const fs = require("fs");
const path = require("path");
const os = require("os");
const { roots, jsonLines, walkFiles } = require("./telemetry");
const { t } = require("./i18n");
const PROVIDER_NAMES = {
  claude: "Claude Code",
  codex: "Codex CLI",
  antigravity: "Antigravity",
};
const HEAD_BYTES = 512 * 1024;
const NATIVE_LIMIT = 300;
const CLAUDE_ID = /^[a-zA-Z0-9_-]{8,160}$/;
// Text typed by the person; commands, command output and the CLI's internal notices don't count.
function promptText(content) {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((c) => c?.type === "text" || c?.type === "input_text")
            .map((c) => c.text || "")
            .join("\n")
        : "";
  const clean = text.trim();
  if (
    !clean ||
    clean.startsWith("<") ||
    clean.startsWith("/") ||
    clean.startsWith("Caveat:") ||
    clean.startsWith("# AGENTS.md instructions")
  )
    return "";
  return clean;
}
// AGY: the typed message comes wrapped in metadata (<USER_REQUEST>…</USER_REQUEST>, local time,
// model switch). Only what the person wrote is kept (AGY 1.4.12).
function agyUserText(content) {
  const text = typeof content === "string" ? content : "";
  const request = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/.exec(text);
  return request ? request[1].trim() : text;
}
// Slack between the time in AGY's history.jsonl and the conversation's first step.
const AGY_MATCH_MS = 2 * 60 * 1000;
// Rewrites a .jsonl index without the deleted conversation's lines (atomic file swap).
function dropLines(file, matches) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const lines = text.split("\n");
  const kept = lines.filter((line) => {
    if (!line) return true;
    try {
      return !matches(JSON.parse(line));
    } catch {
      return true;
    }
  });
  if (kept.length === lines.length) return;
  const temp = `${file}.beagledock-${process.pid}.tmp`;
  const mode = fs.statSync(file).mode & 0o777;
  fs.writeFileSync(temp, kept.join("\n"), { mode });
  fs.renameSync(temp, file);
}
function createHistory({ home = os.homedir(), env = process.env } = {}) {
  const dirs = roots(home, env);
  function nativeFile(provider, id) {
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(id || ""))
      throw new Error(t("errors.invalidConversationId"));
    if (provider === "antigravity")
      return path.join(
        dirs.agy,
        "brain",
        id,
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
    if (!["claude", "codex"].includes(provider))
      throw new Error(t("errors.invalidProvider"));
    const root =
      provider === "claude"
        ? path.join(dirs.claude, "projects")
        : path.join(dirs.codex, "sessions");
    return walkFiles(root).find((f) =>
      provider === "claude"
        ? path.basename(f.full) === `${id}.jsonl`
        : path.basename(f.full).endsWith(`-${id}.jsonl`),
    )?.full;
  }
  // Reads only the start of the file: the title and directory are in the first lines, and the native logs
  // add up to hundreds of MB.
  function headEvents(file, maxBytes = HEAD_BYTES) {
    let fd;
    try {
      fd = fs.openSync(file, "r");
      const buffer = Buffer.alloc(maxBytes);
      const read = fs.readSync(fd, buffer, 0, maxBytes, 0);
      const text = buffer.subarray(0, read).toString("utf8");
      const lines = text.split("\n");
      if (read === maxBytes) lines.pop();
      return lines.flatMap((line) => {
        if (!line) return [];
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  // First message of each AGY conversation in brain/<id> created since `since` (ms).
  function agyBrainIndex(since) {
    const root = path.join(dirs.agy, "brain");
    let names = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      return [];
    }
    const out = [];
    for (const id of names) {
      if (!/^[a-zA-Z0-9_-]{8,160}$/.test(id)) continue;
      const file = path.join(root, id, ".system_generated", "logs", "transcript.jsonl");
      try {
        if (fs.statSync(file).mtimeMs < since - AGY_MATCH_MS) continue;
      } catch {
        continue;
      }
      const first = headEvents(file, 64 * 1024).find((e) => e.type === "USER_INPUT");
      const at = Date.parse(first?.created_at);
      if (first && Number.isFinite(at)) out.push({ id, text: agyUserText(first.content), at });
    }
    return out;
  }
  function history({ query = "", exclude = [] } = {}) {
    const skip = new Set(exclude);
    const items = new Map();
    const add = (provider, id, title, cwd, ts, model = "") => {
      const prompt = typeof title === "string" ? title.trim() : "";
      // A session without any real message (probes, internal commands) isn't a conversation.
      if (!id || !cwd || !prompt || !Number.isFinite(ts)) return;
      const key = `${provider}:${id}`;
      if (skip.has(key)) return;
      if (items.has(key) && items.get(key).timestampMs >= ts) return;
      items.set(key, {
        id: key,
        source: "native",
        provider,
        providerName: PROVIDER_NAMES[provider],
        title: prompt.slice(0, 100),
        prompt,
        project: cwd,
        date: new Date(ts).toLocaleString(),
        timestampMs: ts,
        sessionId: id,
        model,
      });
    };
    // Claude Code: each conversation is a file in projects/<folder>/<id>.jsonl, including the ones opened
    // without a terminal (history.jsonl only gets what was typed in interactive mode).
    const claudeRoot = path.join(dirs.claude, "projects");
    const claudeFiles = walkFiles(claudeRoot)
      .filter(
        (f) =>
          path.dirname(path.dirname(f.full)) === claudeRoot &&
          CLAUDE_ID.test(path.basename(f.full, ".jsonl")),
      )
      .slice(0, NATIVE_LIMIT);
    for (const file of claudeFiles) {
      const id = path.basename(file.full, ".jsonl");
      if (skip.has(`claude:${id}`)) continue;
      const events = headEvents(file.full);
      const cwd = events.find((e) => typeof e.cwd === "string")?.cwd;
      let first = "";
      for (const ev of events) {
        if (ev.type !== "user" || ev.isMeta || ev.isSidechain) continue;
        const text = promptText(ev.message?.content);
        if (text) {
          first = text;
          break;
        }
      }
      add("claude", id, first, cwd, file.mtime);
    }
    const index = new Map(
      jsonLines(path.join(dirs.codex, "session_index.jsonl")).map((x) => [
        x.id,
        x,
      ]),
    );
    for (const file of walkFiles(path.join(dirs.codex, "sessions")).slice(
      0,
      NATIVE_LIMIT,
    )) {
      const events = headEvents(file.full);
      const meta = events.find((e) => e.type === "session_meta")?.payload;
      if (!meta?.id || !meta.cwd) continue;
      const named = index.get(meta.id);
      const first = events
        .filter(
          (e) => e.type === "event_msg" && e.payload?.type === "user_message",
        )
        .map((e) => promptText(e.payload.message))
        .find(Boolean);
      add(
        "codex",
        meta.id,
        named?.thread_name || first,
        meta.cwd,
        named?.updated_at ? new Date(named.updated_at).getTime() : file.mtime,
        meta.model || "",
      );
    }
    const agyLines = jsonLines(path.join(dirs.agy, "history.jsonl")).slice(-1000);
    // New conversation opened in AGY's interface: the history.jsonl line comes without the conversation ID
    // (just text, time and folder; AGY 1.4.12). The ID comes from the brain/<id> folder, by the first message and
    // by the time.
    const loose = agyLines.filter((ev) => !ev.conversationId && ev.display && ev.workspace);
    const brain = loose.length ? agyBrainIndex(Math.min(...loose.map((ev) => Number(ev.timestamp) || 0))) : [];
    const used = new Set();
    for (const ev of agyLines) {
      let id = ev.conversationId;
      const at = new Date(ev.timestamp).getTime();
      if (!id && ev.display && ev.workspace) {
        const text = String(ev.display).trim();
        const match = brain
          .filter((b) => !used.has(b.id) && b.text === text && Math.abs(b.at - at) <= AGY_MATCH_MS)
          .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
        if (match) {
          used.add(match.id);
          id = match.id;
        }
      }
      add("antigravity", id, ev.display, ev.workspace, at);
    }
    const term = String(query || "").trim().toLowerCase();
    return [...items.values()]
      .filter(
        (h) =>
          !term ||
          h.prompt.toLowerCase().includes(term) ||
          h.project.toLowerCase().includes(term),
      )
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, NATIVE_LIMIT);
  }
  /**
   * Deletes the native conversation from disk: the conversation file, the helper folder (subagents, long
   * outputs) and its lines in the CLI's indexes. Only touches each CLI's data folders.
   */
  function remove(provider, id) {
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(id || ""))
      throw new Error(t("errors.invalidConversationId"));
    const removed = [];
    const rm = (target) => {
      if (!fs.existsSync(target)) return;
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(target);
    };
    if (provider === "antigravity") {
      rm(path.join(dirs.agy, "brain", id));
      dropLines(path.join(dirs.agy, "history.jsonl"), (e) => e.conversationId === id);
      return removed;
    }
    if (provider === "claude") {
      const file = nativeFile(provider, id);
      if (file) {
        rm(file);
        rm(path.join(path.dirname(file), id));
      }
      dropLines(path.join(dirs.claude, "history.jsonl"), (e) => e.sessionId === id);
      return removed;
    }
    if (provider === "codex") {
      for (const file of walkFiles(path.join(dirs.codex, "sessions")).concat(
        walkFiles(path.join(dirs.codex, "archived_sessions")),
      ))
        if (path.basename(file.full).endsWith(`-${id}.jsonl`)) rm(file.full);
      dropLines(path.join(dirs.codex, "session_index.jsonl"), (e) => e.id === id);
      return removed;
    }
    throw new Error(t("errors.invalidProvider"));
  }
  // `fallbackCwd`: the already known folder (terminal mode), for conversations the CLI doesn't record in
  // its index (e.g. AGY without a line in history.jsonl).
  function conversation(provider, id, { cwd: fallbackCwd } = {}) {
    const file = nativeFile(provider, id);
    if (!file || !fs.existsSync(file))
      throw new Error(t("errors.conversationNotOnDisk"));
    const events = jsonLines(file);
    const item = history().find(
      (h) => h.provider === provider && h.sessionId === id,
    );
    let cwd =
      provider === "codex"
        ? events.find((e) => e.type === "session_meta")?.payload?.cwd
        : events.find((e) => e.cwd)?.cwd;
    cwd ||= item?.project || fallbackCwd;
    if (!cwd)
      throw new Error(
        t("errors.conversationCwdUnknown"),
      );
    const messages = [];
    let model = item?.model || "";
    for (const [index, ev] of events.entries()) {
      let role, content;
      if (provider === "claude" && ["user", "assistant"].includes(ev.type)) {
        role = ev.type;
        content = ev.message?.content;
        model = ev.message?.model || model;
      }
      if (
        provider === "codex" &&
        ev.payload?.type === "message" &&
        ["user", "assistant"].includes(ev.payload.role)
      ) {
        role = ev.payload.role;
        content = ev.payload.content;
      }
      if (
        provider === "antigravity" &&
        ["USER_INPUT", "PLANNER_RESPONSE"].includes(ev.type)
      ) {
        role = ev.type === "USER_INPUT" ? "user" : "assistant";
        content = role === "user" ? agyUserText(ev.content) : ev.content;
      }
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter((c) =>
                  ["text", "input_text", "output_text"].includes(c.type),
                )
                .map((c) => c.text || "")
                .join("\n")
            : "";
      if (
        !text ||
        text.startsWith("# AGENTS.md instructions") ||
        text.startsWith("<environment_context>") ||
        text.startsWith("<command-name>")
      )
        continue;
      messages.push({
        id: `import-${provider}-${id}-${index}`,
        sessionId: `history-${provider}-${id}`,
        sender: role === "user" ? "user" : provider,
        senderName: role === "user" ? t("profile.you") : item?.providerName || provider,
        text,
        modelBadge: role === "assistant" ? model : undefined,
        timestamp: ev.timestamp || ev.created_at || "",
      });
    }
    return { messages, cwd, model, nativeSessionId: id };
  }
  return { history, conversation, remove };
}
module.exports = { createHistory };
