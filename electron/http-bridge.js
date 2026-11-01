const { timingSafeEqual } = require("crypto");
const ALLOWED_METHODS = new Set([
  "detectTools",
  "getCliApprovals",
  "resolveCliApproval",
  "getGlobalPermissions",
  "saveGlobalPermissions",
  "checkCliUpdates",
  "readNotifications",
  "updateCli",
  "getAIMemoryStatus",
  "searchAIMemory",
  "listAIMemoryPages",
  "readAIMemoryPage",
  "runAIMemoryCommand",
  "getAIMemoryScope",
  "listAIMemoryProjects",
  "listAIMemoryProjectPages",
  "getAIMemoryProjectOverview",
  "listAIMemoryProjectSessions",
  "getAIMemoryMaintenancePrompt",
  "getAIMemoryMaintenanceCwd",
  "getInstalledSkills",
  "getCliHistory",
  "loadFullConversation",
  "getUserProfile",
  "getAppVersion",
  "getSavedState",
  "saveSession",
  "setSessionArchived",
  "deleteSession",
  "saveWorkspace",
  "saveAppSettings",
  "replaceChatMessages",
  "saveChatMessage",
  "getChatMessages",
  "ptySpawn",
  "ptyWrite",
  "ptyResize",
  "executeCliPrompt",
  "interruptCliSession",
  "cancelQueuedPrompt",
  "forceQueuedPrompt",
]);
function matches(a, b) {
  return (
    typeof a === "string" &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
function createHttpBridge({ bridge, token, origin, maxBody = 1024 * 1024 }) {
  const clients = new Set();
  const unsubscribe = bridge.subscribe((channel, payload) => {
    const message = `data: ${JSON.stringify({ channel, payload })}\n\n`;
    for (const res of clients) {
      if (!res.write(message)) {
        res.end();
        clients.delete(res);
      }
    }
  });
  const json = (res, status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(body));
  };
  async function handle(
    req,
    res,
    next = () => json(res, 404, { error: "Rota não encontrada." }),
  ) {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/__beagledock/")) return next();
    const expected = new URL(origin);
    if (
      req.headers.host !== expected.host ||
      (req.headers.origin && req.headers.origin !== origin) ||
      (req.headers["sec-fetch-site"] &&
        !["same-origin", "none"].includes(req.headers["sec-fetch-site"]))
    )
      return json(res, 403, { error: "Origem não autorizada." });
    const events = url.pathname === "/__beagledock/events";
    const presented = events
      ? url.searchParams.get("token")
      : req.headers.authorization?.replace(/^Bearer /, "");
    if (!matches(presented, token))
      return json(res, 401, { error: "Credencial local inválida." });
    if (events) {
      if (req.method !== "GET") return json(res, 405, { error: "Use GET." });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20000);
      res.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });
      return;
    }
    if (url.pathname !== "/__beagledock/invoke")
      return json(res, 404, { error: "Rota não encontrada." });
    if (req.method !== "POST") return json(res, 405, { error: "Use POST." });
    if (req.headers["content-type"]?.split(";")[0] !== "application/json")
      return json(res, 415, { error: "Use application/json." });
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBody) {
          json(res, 413, { error: "Pedido excedeu o limite." });
          return;
        }
        chunks.push(chunk);
      }
      let data;
      try {
        data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return json(res, 400, { error: "JSON inválido." });
      }
      if (
        !data ||
        !ALLOWED_METHODS.has(data.method) ||
        Object.keys(data).some((key) => !["method", "args"].includes(key)) ||
        !Array.isArray(data.args) ||
        data.args.length > 10
      )
        return json(res, 400, { error: "Método ou argumentos inválidos." });
      const result = await bridge.invoke(data.method, data.args);
      json(res, 200, { result: result ?? null });
    } catch (error) {
      if (!res.headersSent) json(res, 500, { error: error.message });
    }
  }
  return {
    handle,
    close: () => {
      unsubscribe();
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}
module.exports = { createHttpBridge };
