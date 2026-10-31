const fs = require("fs");
const path = require("path");
const os = require("os");
const { roots, jsonLines, walkFiles } = require("./telemetry");
function createHistory({ home = os.homedir(), env = process.env } = {}) {
  const dirs = roots(home, env);
  function nativeFile(provider, id) {
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(id || ""))
      throw new Error("ID de conversa inválido.");
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
      throw new Error("Provedor inválido.");
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
  function history() {
    const items = new Map();
    const add = (provider, id, title, cwd, ts, model = "") => {
      if (!id || !cwd || !Number.isFinite(ts)) return;
      const key = `${provider}:${id}`;
      if (items.has(key) && items.get(key).timestampMs >= ts) return;
      items.set(key, {
        id: key,
        provider,
        providerName: {
          claude: "Claude Code",
          codex: "Codex CLI",
          antigravity: "Antigravity",
        }[provider],
        title: title?.slice(0, 100) || "Conversa",
        prompt: title || "",
        project: cwd,
        date: new Date(ts).toLocaleString(),
        timestampMs: ts,
        sessionId: id,
        model,
      });
    };
    for (const ev of jsonLines(path.join(dirs.claude, "history.jsonl")).slice(
      -1000,
    ))
      add("claude", ev.sessionId, ev.display, ev.project, Number(ev.timestamp));
    const index = new Map(
      jsonLines(path.join(dirs.codex, "session_index.jsonl")).map((x) => [
        x.id,
        x,
      ]),
    );
    for (const file of walkFiles(path.join(dirs.codex, "sessions"))) {
      const events = jsonLines(file.full);
      const meta = events.find((e) => e.type === "session_meta")?.payload;
      if (!meta?.id || !meta.cwd) continue;
      const named = index.get(meta.id);
      const first = events.find(
        (e) => e.type === "event_msg" && e.payload?.type === "user_message",
      )?.payload.message;
      add(
        "codex",
        meta.id,
        named?.thread_name || first,
        meta.cwd,
        named?.updated_at ? new Date(named.updated_at).getTime() : file.mtime,
        meta.model || "",
      );
    }
    for (const ev of jsonLines(path.join(dirs.agy, "history.jsonl")).slice(
      -1000,
    ))
      add(
        "antigravity",
        ev.conversationId,
        ev.display,
        ev.workspace,
        new Date(ev.timestamp).getTime(),
      );
    return [...items.values()]
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, 100);
  }
  function conversation(provider, id) {
    const file = nativeFile(provider, id);
    if (!file || !fs.existsSync(file))
      throw new Error("Conversa não encontrada no disco.");
    const events = jsonLines(file);
    const item = history().find(
      (h) => h.provider === provider && h.sessionId === id,
    );
    let cwd =
      provider === "codex"
        ? events.find((e) => e.type === "session_meta")?.payload?.cwd
        : events.find((e) => e.cwd)?.cwd;
    cwd ||= item?.project;
    if (!cwd)
      throw new Error(
        "O diretório original desta conversa não pôde ser identificado.",
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
        content = ev.content;
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
        senderName: role === "user" ? "Você" : item?.providerName || provider,
        text,
        modelBadge: role === "assistant" ? model : undefined,
        timestamp: ev.timestamp || ev.created_at || "",
      });
    }
    return { messages, cwd, model, nativeSessionId: id };
  }
  return { history, conversation };
}
module.exports = { createHistory };
