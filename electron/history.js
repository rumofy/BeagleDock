const fs = require("fs");
const path = require("path");
const os = require("os");
const { roots, jsonLines, walkFiles } = require("./telemetry");
const PROVIDER_NAMES = {
  claude: "Claude Code",
  codex: "Codex CLI",
  antigravity: "Antigravity",
};
const HEAD_BYTES = 512 * 1024;
const NATIVE_LIMIT = 300;
const CLAUDE_ID = /^[a-zA-Z0-9_-]{8,160}$/;
// Texto digitado pela pessoa; comandos, saídas de comando e avisos internos da CLI não contam.
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
// Reescreve um índice .jsonl sem as linhas da conversa apagada (troca atômica do arquivo).
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
  // Lê só o começo do arquivo: o título e o diretório estão nas primeiras linhas, e os logs nativos
  // passam de centenas de MB somados.
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
  function history({ query = "", exclude = [] } = {}) {
    const skip = new Set(exclude);
    const items = new Map();
    const add = (provider, id, title, cwd, ts, model = "") => {
      const prompt = typeof title === "string" ? title.trim() : "";
      // Sessão sem nenhuma mensagem de verdade (sondagens, comandos internos) não é conversa.
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
    // Claude Code: cada conversa é um arquivo em projects/<pasta>/<id>.jsonl, inclusive as abertas
    // sem terminal (o history.jsonl só recebe o que foi digitado no modo interativo).
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
   * Apaga a conversa nativa do disco: o arquivo da conversa, a pasta auxiliar (subagentes, saídas
   * longas) e as linhas dela nos índices da CLI. Só mexe dentro das pastas de dados de cada CLI.
   */
  function remove(provider, id) {
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(id || ""))
      throw new Error("ID de conversa inválido.");
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
    throw new Error("Provedor inválido.");
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
  return { history, conversation, remove };
}
module.exports = { createHistory };
