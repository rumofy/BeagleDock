const fs = require("fs"),
  path = require("path"),
  os = require("os"),
  net = require("net"),
  crypto = require("crypto");
const { removeLegacyHooks } = require("./migration");
const { settingsPath } = require("./agy-permissions");
const { t } = require("./i18n");
const READ_TOOLS = new Set([
  "read_file",
  "view_file",
  "list_dir",
  "find_by_name",
  "grep_search",
  "list_permissions",
  "manage_task",
  "command_status",
  "list_resources",
  "read_resource",
  "invoke_subagent",
  "define_subagent",
  "manage_subagents",
  "send_message",
  "manage_inbox",
  "wait",
  "wait_5_seconds",
  "finish",
  "ask_question",
]);
const READ_MCP_TOOLS = new Set([
  "memory_query",
  "memory_recent",
  "memory_read_page",
  "memory_read_session_observations",
  "memory_status",
  "memory_briefing",
  "memory_explore",
  "memory_handoff_list",
  "memory_message_list",
]);
const WRITE_TOOLS = new Set([
  "write_to_file",
  "replace_file_content",
  "multi_replace_file_content",
  "edit_file",
  "write_file",
]);
function effectivePermission(permission, options) {
  if (permission !== "inherit") return permission;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath(options), "utf8"));
    if (
      settings?.toolPermission === "always-proceed" ||
      settings?.agentMode === "auto"
    )
      return "full";
    if (settings?.agentMode === "plan") return "plan";
    if (settings?.toolPermission === "strict") return "strict";
  } catch {}
  return "edits";
}
function ensureHook({
  home = os.homedir(),
  env = process.env,
  node = process.execPath,
  script = path.join(__dirname, "agy-approval-hook.cjs"),
} = {}) {
  const file = path.join(
    env.GEMINI_CLI_HOME || path.join(home, ".gemini"),
    "config",
    "hooks.json",
  );
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  let hooks;
  try {
    hooks = text ? JSON.parse(text) : {};
    if (!hooks || typeof hooks !== "object" || Array.isArray(hooks))
      throw new Error();
  } catch {
    throw new Error(t("errors.agyHooksInvalid"));
  }
  const quote = (value) =>
    process.platform === "win32"
      ? '"' + value.replace(/"/g, '""') + '"'
      : "'" + value.replace(/'/g, "'\\''") + "'";
  const psQuote = (value) => "'" + value.replace(/'/g, "''") + "'";
  const windowsScript = `$OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::InputEncoding = $OutputEncoding; [Console]::OutputEncoding = $OutputEncoding; $env:ELECTRON_RUN_AS_NODE='1'; $payload=[Console]::In.ReadToEnd(); $payload | & ${psQuote(node)} ${psQuote(script)}`;
  const command =
    process.platform === "win32"
      ? "powershell.exe -NoProfile -NonInteractive -EncodedCommand " +
        Buffer.from(windowsScript, "utf16le").toString("base64")
      : "ELECTRON_RUN_AS_NODE=1 " + quote(node) + " " + quote(script);
  const config = {
    PreToolUse: [
      { matcher: ".*", hooks: [{ type: "command", command, timeout: 130 }] },
    ],
  };
  const legacy = removeLegacyHooks(hooks);
  if (
    !legacy.length &&
    JSON.stringify(hooks["beagledock-permissions"]) === JSON.stringify(config)
  )
    return;
  hooks["beagledock-permissions"] = config;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (text && !fs.existsSync(file + ".before-beagledock"))
    fs.writeFileSync(file + ".before-beagledock", text, {
      mode: 0o600,
      flag: "wx",
    });
  const temp = file + ".beagledock.tmp";
  fs.writeFileSync(temp, JSON.stringify(hooks, null, 2) + "\n", {
    mode: 0o600,
  });
  let current = "";
  try {
    current = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (current !== text) {
    fs.unlinkSync(temp);
    throw new Error(t("errors.agyHooksChanged"));
  }
  fs.renameSync(temp, file);
}
async function createAgyApprovalBridge({
  sessionId,
  permission,
  ask,
  getNativeId,
  onConversation = () => {},
  home,
  env,
  node,
  script,
}) {
  ensureHook({ home, env, node, script });
  // Level chosen now in the conversation; `permission` is still the one AGY started with.
  let livePermission = permission;
  const token = crypto.randomBytes(32).toString("hex");
  const socket =
    process.platform === "win32"
      ? `\\\\.\\pipe\\beagledock-${crypto.randomUUID()}`
      : path.join(
          os.tmpdir(),
          `beagledock-${process.pid}-${crypto.randomBytes(8).toString("hex")}.sock`,
        );
  const clients = new Set();
  let closed = false;
  const server = net.createServer((client) => {
    clients.add(client);
    client.on("close", () => clients.delete(client));
    client.on("error", () => {});
    let buffer = "",
      handled = false;
    client.on("data", async (chunk) => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) return client.destroy();
      if (handled || !buffer.includes("\n")) return;
      handled = true;
      let message;
      try {
        message = JSON.parse(buffer.split("\n")[0]);
      } catch {
        return client.destroy();
      }
      if (
        typeof message.token !== "string" ||
        message.token.length !== token.length ||
        !crypto.timingSafeEqual(Buffer.from(message.token), Buffer.from(token))
      )
        return client.destroy();
      const request = message.request || {},
        nativeId = getNativeId();
      if (
        !nativeId ||
        typeof request.conversationId !== "string" ||
        !/^[a-zA-Z0-9_-]{8,160}$/.test(request.conversationId) ||
        !request.toolCall?.name
      ) {
        client.end(
          JSON.stringify({
            decision: "deny",
            reason: "The session doesn't match the request.",
          }) + "\n",
        );
        return;
      }
      // The secret is exclusive to this process tree and is inherited by the subagents.
      // They have their own native IDs; requiring the parent's ID denied their tools without asking.
      // Another process/session still has no access: it must authenticate with this bridge's token.
      onConversation(request.conversationId);
      const name = request.toolCall.name;
      const args = request.toolCall.args || {};
      const activePermission = effectivePermission(livePermission, { home, env });
      const launchedReadonly = ["plan", "ask"].includes(
        effectivePermission(permission, { home, env }),
      );
      const isReadMcp =
        name === "call_mcp_tool" &&
        args.ServerName === "ai-memory" &&
        READ_MCP_TOOLS.has(args.ToolName);
      const isRead = READ_TOOLS.has(name) || isReadMcp;
      let result = { decision: "allow" };
      if (
        !isRead &&
        ["plan", "ask"].includes(activePermission) &&
        !launchedReadonly
      )
        // Switched to read-only during the run: AGY started able to write, so the
        // bridge denies anything that isn't a read until it restarts in plan mode on the next message.
        result = {
          decision: "deny",
          reason: "The conversation's mode was switched to read-only in BeagleDock.",
        };
      else if (
        !["full", "plan", "ask"].includes(activePermission) &&
        !isRead &&
        !(activePermission === "edits" && WRITE_TOOLS.has(name))
      ) {
        const allow = await ask({
          sessionId,
          providerId: "antigravity",
          tool: name,
          input: request.conversationId === nativeId
            ? request.toolCall.args
            : { ...request.toolCall.args, agentConversationId: request.conversationId },
        });
        result = {
          decision: allow ? "auto_approve" : "deny",
          reason: allow
            ? "Allowed once by the user in BeagleDock."
            : "Denied by the user in BeagleDock.",
        };
      }
      if (!closed && !client.destroyed)
        client.end(JSON.stringify(result) + "\n");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  if (process.platform !== "win32") fs.chmodSync(socket, 0o600);
  return {
    env: {
      BEAGLEDOCK_APPROVAL_SOCKET: socket,
      BEAGLEDOCK_APPROVAL_TOKEN: token,
    },
    setPermission(level) {
      livePermission = level;
    },
    close() {
      if (closed) return;
      closed = true;
      for (const client of clients) client.destroy();
      server.close();
      if (process.platform !== "win32")
        try {
          fs.unlinkSync(socket);
        } catch {}
    },
  };
}
module.exports = { ensureHook, createAgyApprovalBridge };
