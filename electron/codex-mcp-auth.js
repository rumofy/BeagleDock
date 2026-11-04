const { findBinary, execCli } = require("./platform");
const { t } = require("./i18n");

const ANSI = /\x1B\[[0-9;?]*[a-zA-Z]/g;

// Hosts of remote MCPs Codex couldn't authenticate, from the PTY output:
// `... AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=\"https://mcp.postman.com/..."`
function authErrorHosts(text) {
  const clean = String(text || "").replace(ANSI, "");
  if (!/AuthRequired/i.test(clean)) return [];
  const hosts = new Set();
  for (const match of clean.matchAll(/https?:\/\/([a-z0-9.-]+)(?::\d+)?/gi))
    hosts.add(match[1].toLowerCase());
  return [...hosts];
}

const LOG_START = /^\s*\d{4}-\d{2}-\d{2}T/;
const LOG_PREFIX = /^\s*\d{0,4}(-\d{0,2}(-\d{0,2}T?)?)?$/;
const isAuthLogLine = (line) => {
  const clean = line.replace(ANSI, "");
  return /rmcp::transport/.test(clean) && /AuthRequired/i.test(clean);
};

// Codex's app-server writes diagnostic logs to stderr (the TUI saves them to a file).
// The MCP-without-login line is taken out of the shell and handed to `onAuthError`; the rest passes through.
function createStderrFilter({ forward, onAuthError }) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (isAuthLogLine(line)) onAuthError(line);
      else forward(line + "\n");
    }
    const clean = buffer.replace(ANSI, "");
    if (buffer && !LOG_START.test(clean) && !LOG_PREFIX.test(clean)) {
      forward(buffer);
      buffer = "";
    }
  };
}

function serverHost(server) {
  try {
    return new URL(server?.transport?.url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function pendingLogins(listJson) {
  let servers;
  try {
    servers = JSON.parse(listJson);
  } catch {
    return [];
  }
  return (Array.isArray(servers) ? servers : []).filter(
    (s) => s?.enabled && s.auth_status === "not_logged_in",
  );
}

function createMcpAuthWatcher({
  notify,
  find = findBinary,
  exec = execCli,
  now = Date.now,
  cooldownMs = 10 * 60000,
} = {}) {
  const handled = new Map();
  async function report(host) {
    let name = host;
    let command;
    try {
      const bin = find("codex");
      if (bin) {
        const { stdout } = await exec(bin, ["mcp", "list", "--json"], {
          timeout: 15000,
        });
        const server = pendingLogins(stdout).find(
          (s) => serverHost(s) === host,
        );
        if (server) {
          name = server.name;
          command = `codex mcp login ${server.name}`;
        }
      }
    } catch {}
    notify(
      `mcp-auth:codex:${name}`,
      "mcp_auth",
      t("mcpAuth.title", { name }),
      t("mcpAuth.body", { host }) +
        (command
          ? t("mcpAuth.withCommand")
          : t("mcpAuth.withoutCommand")),
      command ? { actionCommand: command } : {},
    );
  }
  return {
    inspect(chunk) {
      for (const host of authErrorHosts(chunk)) {
        const last = handled.get(host);
        if (last !== undefined && now() - last < cooldownMs) continue;
        handled.set(host, now());
        void report(host);
      }
    },
  };
}

module.exports = {
  createMcpAuthWatcher,
  authErrorHosts,
  createStderrFilter,
  pendingLogins,
  serverHost,
};
