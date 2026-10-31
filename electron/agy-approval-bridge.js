const fs = require("fs"),
  path = require("path"),
  os = require("os"),
  net = require("net"),
  crypto = require("crypto");
const READ_TOOLS = new Set([
  "read_file",
  "view_file",
  "list_dir",
  "find_by_name",
  "grep_search",
  "list_permissions",
  "manage_task",
]);
const WRITE_TOOLS = new Set([
  "write_to_file",
  "replace_file_content",
  "multi_replace_file_content",
  "edit_file",
  "write_file",
]);
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
    throw new Error("hooks.json do AGY é inválido. Não foi alterado.");
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
  if (
    JSON.stringify(hooks["bleagledock-permissions"]) === JSON.stringify(config)
  )
    return;
  hooks["bleagledock-permissions"] = config;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (text && !fs.existsSync(file + ".before-bleagledock"))
    fs.writeFileSync(file + ".before-bleagledock", text, {
      mode: 0o600,
      flag: "wx",
    });
  const temp = file + ".bleagledock.tmp";
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
    throw new Error("Hooks alterados por outro processo. Tente novamente.");
  }
  fs.renameSync(temp, file);
}
async function createAgyApprovalBridge({
  sessionId,
  permission,
  ask,
  getNativeId,
  home,
  env,
  node,
  script,
}) {
  ensureHook({ home, env, node, script });
  const token = crypto.randomBytes(32).toString("hex");
  const socket =
    process.platform === "win32"
      ? `\\\\.\\pipe\\bleagledock-${crypto.randomUUID()}`
      : path.join(
          os.tmpdir(),
          `bleagle-${process.pid}-${crypto.randomBytes(8).toString("hex")}.sock`,
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
        request.conversationId !== nativeId ||
        !request.toolCall?.name
      ) {
        client.end(
          JSON.stringify({
            decision: "deny",
            reason: "Sessão não corresponde ao pedido.",
          }) + "\n",
        );
        return;
      }
      const name = request.toolCall.name;
      let result = { decision: "allow" };
      if (
        !["full", "plan", "ask"].includes(permission) &&
        !READ_TOOLS.has(name) &&
        !(permission === "edits" && WRITE_TOOLS.has(name))
      ) {
        const allow = await ask({
          sessionId,
          providerId: "antigravity",
          tool: name,
          input: request.toolCall.args,
        });
        result = {
          decision: allow ? "auto_approve" : "deny",
          reason: allow
            ? "Autorizado uma vez pelo usuário no BeagleDock."
            : "Negado pelo usuário no BeagleDock.",
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
      BLEAGLEDOCK_APPROVAL_SOCKET: socket,
      BLEAGLEDOCK_APPROVAL_TOKEN: token,
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
