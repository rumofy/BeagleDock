const { t } = require("./i18n");
// Terminal mode: the CLI runs with its own interface (TUI) in a pty, without the chat's structured
// protocol. Whoever picks this mode gets everything from the CLI (typing, attachments, plan, approvals and
// its history); BeagleDock only opens the process in the right conversation and relays keys and screen.
const PROVIDERS = new Set(["claude", "codex", "antigravity"]);
// Output kept per terminal to redraw the screen when the view is remounted (conversation switch
// or a panel with several terminals). The TUI redraws everything on resize, so the end is enough.
const REPLAY_LIMIT = 512 * 1024;

/**
 * Arguments that open the CLI's interface, resuming the native conversation when it already exists. In a
 * new conversation, Claude Code gets the ID it will use (`newId`), so the history finds it later.
 */
function terminalArgs(providerId, nativeId, newId) {
  if (!PROVIDERS.has(providerId)) throw new Error(t("errors.unknownCli"));
  // Codex's TUI draws in the alternate screen by default, which has no scrollback: the terminal had no
  // scrollbar and the wheel didn't scroll the conversation. Inline mode keeps the output in the regular
  // scrollback (verified in Codex CLI 0.167.0). Claude Code and Antigravity handle the wheel themselves.
  const prefix = providerId === "codex" ? ["--no-alt-screen"] : [];
  // Never starts with "-": it would become a CLI option instead of the conversation id.
  const valid = (id) => /^[a-zA-Z0-9_][a-zA-Z0-9_-]{7,159}$/.test(id);
  if (!nativeId) {
    if (providerId === "claude" && newId) {
      if (!valid(newId)) throw new Error(t("errors.invalidNativeId"));
      return ["--session-id", newId];
    }
    return prefix;
  }
  if (!valid(nativeId)) throw new Error(t("errors.invalidNativeId"));
  if (providerId === "codex") return [...prefix, "resume", nativeId];
  if (providerId === "claude") return ["--resume", nativeId];
  return ["--conversation", nativeId];
}

// Markers of the Claude Code session that opened BeagleDock (e.g. `npm run dev` inside it). If inherited,
// the terminal's CLI thinks it's a child of that session and turns off conversation saving (verified in
// Claude Code 2.1.317: "Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker").
const INHERITED_SESSION_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_PID",
];

function terminalEnv(base) {
  const env = { ...base, TERM: "xterm-256color", COLORTERM: "truecolor" };
  // The chat turns colors off; the CLI's interface needs them.
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  for (const name of INHERITED_SESSION_VARS) delete env[name];
  return env;
}

function createCliTerminals({
  pty,
  find,
  env = () => process.env,
  checkCwd,
  store,
  // Called before opening: refuses if the conversation has a turn running in the chat and stops its
  // idle process, so the two modes never write to the same conversation at the same time.
  beforeOpen = async () => {},
  emit = () => {},
  // Tracking of each terminal (end of reply, history): opened, input, output, exited, closed.
  hooks = {},
  newId = () => require("crypto").randomUUID(),
}) {
  const hook = (name, ...args) => {
    try {
      hooks[name]?.(...args);
    } catch {}
  };
  const terminals = new Map();

  function binary(providerId) {
    return providerId === "antigravity" ? find("agy") || find("antigravity") : find(providerId);
  }

  function info(id, entry) {
    return {
      sessionId: id,
      providerId: entry.providerId,
      cwd: entry.cwd,
      pid: entry.pid,
      cols: entry.cols,
      rows: entry.rows,
      resumed: entry.resumed,
      exited: entry.exited,
      exitCode: entry.exitCode,
      // Total characters emitted: the view discards events already contained in `replay`.
      end: entry.total,
    };
  }

  // Two views opening at the same time (the grid and the conversation, or React's double effect in
  // development) wait for the same opening: never two processes for the same conversation.
  const opening = new Map();
  function open(request = {}) {
    const id = request.sessionId;
    if (opening.has(id)) return opening.get(id).then((r) => {
      if (r.ok && (r.providerId !== request.providerId || r.cwd !== request.cwd))
        return { ok: false, error: t("errors.otherDirectory") };
      return r.ok ? reopen(id, r) : r;
    });
    const pending = start(request).finally(() => opening.delete(id));
    if (typeof id === "string") opening.set(id, pending);
    return pending;
  }
  function reopen(id, result) {
    const entry = terminals.get(id);
    return entry ? { ok: true, ...info(id, entry), replay: entry.replay } : result;
  }

  async function start({ sessionId, providerId, cwd, cols, rows } = {}) {
    let cwdLocked = false;
    if (typeof sessionId !== "string" || !sessionId) return { ok: false, error: t("errors.invalidConversation") };
    if (!PROVIDERS.has(providerId)) return { ok: false, error: t("errors.unknownCli") };
    const existing = terminals.get(sessionId);
    if (existing && !existing.exited) {
      if (existing.providerId !== providerId || existing.cwd !== cwd)
        return { ok: false, error: t("errors.otherDirectory") };
      return { ok: true, ...info(sessionId, existing), replay: existing.replay };
    }
    if (!pty) return { ok: false, error: t("errors.ptyUnavailable"), cwdLocked };
    try {
      const target = checkCwd(cwd);
      const bin = binary(providerId);
      if (!bin) return { ok: false, error: t("errors.cliNotFound", { id: providerId }), cwdLocked };
      const link = await store.getNativeSession(sessionId, providerId);
      if (link && link.cwd !== target)
        return { ok: false, error: t("errors.otherDirectory") };
      await store.lockSessionCwd(sessionId, providerId, target);
      cwdLocked = true;
      await beforeOpen(sessionId);
      const newNativeId = providerId === "claude" && !link?.nativeId ? newId() : undefined;
      const args = terminalArgs(providerId, link?.nativeId, newNativeId);
      const proc = pty.spawn(bin, args, {
        name: "xterm-256color",
        cols: cols > 0 ? Math.min(cols, 1000) : 100,
        rows: rows > 0 ? Math.min(rows, 500) : 30,
        cwd: target,
        env: terminalEnv(env()),
      });
      const entry = {
        proc,
        pid: proc.pid,
        cols: cols > 0 ? Math.min(cols, 1000) : 100,
        rows: rows > 0 ? Math.min(rows, 500) : 30,
        providerId,
        cwd: target,
        resumed: !!link?.nativeId,
        replay: "",
        total: 0,
        exited: false,
        exitCode: null,
      };
      proc.onData((data) => {
        // An old process (closed or replaced) doesn't write to the current one's screen.
        if (terminals.get(sessionId) !== entry) return;
        entry.replay = (entry.replay + data).slice(-REPLAY_LIMIT);
        entry.total += data.length;
        emit("cli-terminal-data", { sessionId, data, end: entry.total });
        hook("output", sessionId, data);
      });
      proc.onExit(({ exitCode }) => {
        entry.exited = true;
        entry.exitCode = exitCode;
        if (terminals.get(sessionId) !== entry) return;
        emit("cli-terminal-exit", { sessionId, exitCode });
        hook("exited", sessionId);
      });
      terminals.set(sessionId, entry);
      hook("opened", { sessionId, providerId, cwd: target, nativeId: link?.nativeId, newNativeId });
      emit("cli-terminal-opened", { sessionId, pid: entry.pid });
      return { ok: true, ...info(sessionId, entry), replay: "" };
    } catch (error) {
      return { ok: false, error: error.message, cwdLocked };
    }
  }

  function write({ sessionId, data } = {}) {
    const entry = terminals.get(sessionId);
    if (!entry || entry.exited || typeof data !== "string") return { ok: false };
    entry.proc.write(data);
    hook("input", sessionId, data);
    return { ok: true };
  }

  function resize({ sessionId, cols, rows } = {}) {
    const entry = terminals.get(sessionId);
    if (!entry || entry.exited || !(cols > 0) || !(rows > 0)) return { ok: false };
    try {
      entry.proc.resize(Math.min(cols, 1000), Math.min(rows, 500));
      entry.cols = Math.min(cols, 1000);
      entry.rows = Math.min(rows, 500);
    } catch {}
    return { ok: true };
  }

  function close(sessionId) {
    const entry = terminals.get(sessionId);
    if (!entry) return { ok: true };
    terminals.delete(sessionId);
    if (!entry.exited)
      try {
        entry.proc.kill();
      } catch {}
    hook("closed", sessionId);
    emit("cli-terminal-closed", { sessionId });
    return { ok: true };
  }

  return {
    open,
    write,
    resize,
    close,
    isOpen: (sessionId) => {
      const entry = terminals.get(sessionId);
      return !!entry && !entry.exited;
    },
    list: () => [...terminals].map(([id, entry]) => info(id, entry)),
    closeAll: () => {
      for (const id of [...terminals.keys()]) close(id);
    },
  };
}

// Image formats the CLI can read from the clipboard.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/**
 * What the terminal's Ctrl+V does: with an image, it sends the raw Ctrl+V for the CLI itself to read the
 * clipboard and attach; with text, it pastes. Electron's API is asynchronous (`has` and `readText`
 * return Promises; Electron 45 no longer has `availableFormats` or `readImage`): with the
 * synchronous version, Ctrl+V failed silently and no image reached the CLI.
 */
async function readTerminalClipboard(clipboard) {
  const has = async (type) => {
    try {
      return !!(await clipboard.has(type));
    } catch {
      return false;
    }
  };
  // One query at a time: several at once lock up Electron's clipboard on X11
  // (verified in Electron 45). PNG first, the most common screenshot format.
  let image = false;
  for (const type of IMAGE_TYPES) if ((image = await has(type))) break;
  let text = "";
  if (!image)
    try {
      text = await clipboard.readText();
    } catch {}
  return { image, text: typeof text === "string" ? text : "" };
}

module.exports = { createCliTerminals, terminalArgs, terminalEnv, readTerminalClipboard };
