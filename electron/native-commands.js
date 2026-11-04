// Native commands of each CLI, read from the CLI itself on every query (nothing is copied here):
// so commands added or removed in an update show up without changing BeagleDock.
//  - Claude Code: `init` event of a local command (`/context`: doesn't call the model, zero cost).
//  - Antigravity: `command_result` event of `/help` in programmatic mode (also without the model).
//  - Codex: the app-server's `skills/list`; the protocol doesn't list the terminal's built-in commands.
const { findBinary, spawnCli } = require("./platform");
const { t } = require("./i18n");

const PROBE_TIMEOUT_MS = 20000;
const CACHE_TTL_MS = 60000;

// Runs a short process and hands each JSON line to `onEvent`; stops when it returns a value.
function probe({ spawn, bin, args, cwd, send, onEvent, timeoutMs = PROBE_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.stdin?.end();
      } catch {}
      try {
        (child.kill || (() => {})).call(child);
      } catch {}
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error(t("errors.cliTimeout"))),
      timeoutMs,
    );
    const handle = (line) => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      try {
        const value = onEvent(event, (message) =>
          child.stdin.write(JSON.stringify(message) + "\n"),
        );
        if (value !== undefined) finish(null, value);
      } catch (error) {
        finish(error);
      }
    };
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        handle(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    });
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => finish(error));
    child.on("close", (code) =>
      finish(new Error(stderr.trim() || t("errors.cliExitedSilent", { code }))),
    );
    if (send) send((message) => child.stdin.write(JSON.stringify(message) + "\n"));
    else child.stdin.end();
  });
}

const clean = (name) => String(name || "").replace(/^\//, "").trim();

function claudeCommands(init) {
  const terminal = new Set((init.terminal_slash_commands || []).map(clean));
  const skills = new Set((init.skills || []).map(clean));
  const seen = new Set();
  const commands = [];
  for (const raw of [...(init.slash_commands || []), ...(init.terminal_slash_commands || [])]) {
    const name = clean(raw);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    commands.push({
      name,
      kind: skills.has(name) ? "skill" : "command",
      ...(terminal.has(name) ? { terminalOnly: true } : {}),
    });
  }
  return {
    commands,
    state: { model: init.model, permissionMode: init.permissionMode },
  };
}

function agyCommands(data) {
  return {
    commands: (data?.commands || [])
      .filter((c) => clean(c.name))
      .map((c) => ({
        name: clean(c.name),
        kind: "command",
        ...(c.description ? { description: c.description } : {}),
        ...(Array.isArray(c.aliases) && c.aliases.length ? { aliases: c.aliases.map(clean) } : {}),
      })),
  };
}

const describe = (skill) =>
  skill.interface?.shortDescription || skill.shortDescription || skill.description;

function codexSkills(response) {
  const commands = [];
  const seen = new Set();
  for (const entry of response?.data || []) {
    for (const skill of entry.skills || []) {
      const name = clean(skill.name);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      commands.push({
        name,
        kind: "skill",
        ...(describe(skill) ? { description: describe(skill) } : {}),
      });
    }
  }
  return { commands };
}

const LIMITATIONS = {
  codex:
    t("commands.codexNoBuiltins"),
};

function createNativeCommands({
  find = findBinary,
  spawn = spawnCli,
  now = Date.now,
  ttlMs = CACHE_TTL_MS,
  timeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  const cache = new Map();

  async function discover(providerId, cwd) {
    const base = { cwd, spawn, timeoutMs };
    if (providerId === "claude") {
      const bin = find("claude");
      if (!bin) throw new Error(t("errors.notInstalled", { name: "Claude Code" }));
      return claudeCommands(
        await probe({
          ...base,
          bin,
          args: ["-p", "/context", "--output-format", "stream-json", "--verbose"],
          onEvent: (e) => (e.type === "system" && e.subtype === "init" ? e : undefined),
        }),
      );
    }
    if (providerId === "antigravity") {
      const bin = find("agy");
      if (!bin) throw new Error(t("errors.notInstalled", { name: "Antigravity" }));
      return agyCommands(
        await probe({
          ...base,
          bin,
          args: ["-p", "/help", "--output-format", "stream-json"],
          onEvent: (e) =>
            e.event === "command_result" && e.command?.name === "help" ? e.command.data : undefined,
        }),
      );
    }
    if (providerId === "codex") {
      const bin = find("codex");
      if (!bin) throw new Error(t("errors.notInstalled", { name: "Codex CLI" }));
      return codexSkills(
        await probe({
          ...base,
          bin,
          args: ["app-server", "--listen", "stdio://"],
          send: (write) =>
            write({
              id: "init",
              method: "initialize",
              params: { clientInfo: { name: "beagledock", title: "BeagleDock", version: "0" } },
            }),
          onEvent: (e, write) => {
            if (e.id === "init") {
              write({ method: "initialized" });
              write({ id: "skills", method: "skills/list", params: { cwds: [cwd], forceReload: true } });
            } else if (e.id === "skills") {
              if (e.error) throw new Error(e.error.message || t("errors.listSkills"));
              return e.result || {};
            }
            return undefined;
          },
        }),
      );
    }
    throw new Error(t("errors.unknownProvider"));
  }

  return {
    /** Lists the native commands; `refresh` skips the short cache. A failure becomes `{ ok: false }`. */
    async list(providerId, cwd, { refresh = false } = {}) {
      const key = `${providerId}\0${cwd}`;
      const hit = cache.get(key);
      if (!refresh && hit && now() - hit.at < ttlMs) return hit.value;
      try {
        const found = await discover(providerId, cwd);
        const value = {
          ok: true,
          providerId,
          commands: found.commands,
          ...(found.state ? { state: found.state } : {}),
          ...(LIMITATIONS[providerId] ? { limitation: LIMITATIONS[providerId] } : {}),
        };
        cache.set(key, { at: now(), value });
        return value;
      } catch (error) {
        return { ok: false, providerId, commands: [], error: error.message };
      }
    },
  };
}

module.exports = { createNativeCommands, claudeCommands, agyCommands, codexSkills };
