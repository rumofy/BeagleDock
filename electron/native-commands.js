// Comandos nativos de cada CLI, lidos da própria CLI a cada consulta (nada é copiado para cá):
// assim, comandos novos ou removidos numa atualização aparecem sem mudar o BeagleDock.
//  - Claude Code: evento `init` de um comando local (`/context`: não chama o modelo, custo zero).
//  - Antigravity: evento `command_result` de `/help` no modo programático (também sem modelo).
//  - Codex: `skills/list` do app-server; o protocolo não lista os comandos internos do terminal.
const { findBinary, spawnCli } = require("./platform");

const PROBE_TIMEOUT_MS = 20000;
const CACHE_TTL_MS = 60000;

// Executa um processo curto e entrega cada linha JSON a `onEvent`; encerra quando ela devolve um valor.
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
      () => finish(new Error("A CLI não respondeu a tempo.")),
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
      finish(new Error(stderr.trim() || `A CLI encerrou (${code}) sem responder.`)),
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
    "O Codex não informa a lista dos comandos internos do terminal (como /status); aparecem só as skills.",
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
      if (!bin) throw new Error("Claude Code não está instalado.");
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
      if (!bin) throw new Error("Antigravity não está instalado.");
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
      if (!bin) throw new Error("Codex CLI não está instalado.");
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
              if (e.error) throw new Error(e.error.message || "Falha ao listar skills.");
              return e.result || {};
            }
            return undefined;
          },
        }),
      );
    }
    throw new Error("Provedor desconhecido.");
  }

  return {
    /** Lista os comandos nativos; `refresh` ignora o cache curto. Falha vira `{ ok: false }`. */
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
