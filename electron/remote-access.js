// Phone access over the local network: an HTTPS server, off by default, that only answers devices
// on private networks and only after pairing with a one-time code shown on the desktop.
// Each paired device has its own token (stored only as a hash) and can be revoked.
const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const net = require("net");
const os = require("os");
const path = require("path");
const {
  createAuthority,
  issueServerCertificate,
  serverCertificateFits,
  fingerprint,
  pemToDer,
  isPrivateAddress,
} = require("./remote-cert");

const DEFAULT_PORT = 47821;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const PAIRING_ATTEMPTS = 5;
// Photos and files attached in the chat travel in the request (as on the desktop).
const MAX_BODY = 40 * 1024 * 1024;
// Live events queued for a phone that isn't reading (screen off, out of Wi-Fi) before its stream is
// closed. Each stream chunk carries the reply's full text, so a busy reply queues a lot quickly; a
// phone that is reading drains it, one that stopped reconnects and reloads.
const STREAM_BACKLOG_LIMIT = 8 * 1024 * 1024;
const STREAM_HEARTBEAT_MS = 15000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// Events the phone receives: the chat, approvals, quotas and notifications; never the terminal or the shell.
const REMOTE_EVENTS = new Set([
  "tools-update",
  "cli-stream-chunk",
  "cli-activity-event",
  "cli-context",
  "cli-turn-started",
  "cli-turn-finished",
  "cli-notice",
  "cli-permission-changed",
  "cli-approvals",
  "chat-sync",
]);
const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

const sha256 = (text) => crypto.createHash("sha256").update(text).digest();
function sameHash(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function pairingCode() {
  const bytes = crypto.randomBytes(8);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
const normalizeCode = (code) =>
  String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/** LAN addresses of this computer, IPv4 first (what goes into the QR code). */
// Container and virtual machine bridges: only this computer reaches them, never the phone.
const VIRTUAL_INTERFACE = /^(?:docker|br-|veth|virbr|vmnet|vboxnet|cni|flannel|podman|lxc|lxd)/;
function localAddresses(interfaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces)) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const info of list || []) {
      if (info.internal) continue;
      const ip = String(info.address).replace(/%.*$/, "");
      if (!isPrivateAddress(ip) || ip.startsWith("fe80:")) continue;
      if (!out.includes(ip)) out.push(ip);
    }
  }
  return out.sort((a, b) => Number(net.isIPv6(a)) - Number(net.isIPv6(b)));
}
const mdnsName = (hostname = os.hostname()) => {
  const label = String(hostname || "")
    .split(".")[0]
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  return label ? `${label}.local` : null;
};
/** Host header the server answers to: an IP literal, a `.local` name or localhost (blocks DNS rebinding). */
function allowedHost(host) {
  if (typeof host !== "string" || !host) return false;
  const name = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.replace(/:\d+$/, "");
  if (net.isIP(name)) return isPrivateAddress(name);
  return /^(?:[a-z0-9-]+\.)*[a-z0-9-]+\.local$/i.test(name) || name === "localhost";
}

function createSecretBox(storage) {
  const usable = () =>
    !!storage?.isEncryptionAvailable?.() &&
    storage.getSelectedStorageBackend?.() !== "basic_text";
  return {
    seal: (text) =>
      usable()
        ? { encrypted: 1, ciphertext: storage.encryptString(text).toString("base64") }
        : { encrypted: 0, value: text },
    open: (box) => {
      if (!box) return null;
      if (box.encrypted !== 1) return box.value ?? null;
      try {
        return storage.decryptString(Buffer.from(box.ciphertext, "base64"));
      } catch {
        return null;
      }
    },
  };
}

function createRemoteAccess({
  dir,
  api,
  staticDir,
  storage,
  messages = (key) => key,
  onChange = () => {},
  interfaces = () => os.networkInterfaces(),
  hostname = () => os.hostname(),
  now = () => Date.now(),
  log = console,
}) {
  const file = path.join(dir, "remote-access.json");
  const box = createSecretBox(storage);
  let state = load();
  let server = null;
  let listening = false;
  let lastError = null;
  let pairing = null;
  const streams = new Map(); // response -> device id

  function load() {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return {
        enabled: data.enabled === true,
        port: Number.isInteger(data.port) && data.port >= 0 && data.port <= 65535 ? data.port : DEFAULT_PORT,
        authority: data.authority || null,
        server: data.server || null,
        devices: Array.isArray(data.devices) ? data.devices : [],
      };
    } catch {
      return { enabled: false, port: DEFAULT_PORT, authority: null, server: null, devices: [] };
    }
  }
  function save() {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  const changed = () => {
    try {
      onChange(status());
    } catch {}
  };

  function authority() {
    const key = state.authority && box.open(state.authority.key);
    if (state.authority?.cert && key) return { cert: state.authority.cert, key };
    const created = createAuthority();
    state.authority = { cert: created.cert, key: box.seal(created.key) };
    state.server = null;
    save();
    return created;
  }
  function serverCredentials() {
    const ca = authority();
    const ips = ["127.0.0.1", ...localAddresses(interfaces())];
    const name = mdnsName(hostname());
    const names = ["localhost", ...(name ? [name] : [])];
    const key = state.server && box.open(state.server.key);
    if (key && serverCertificateFits(state.server, ips, names, now()))
      return { cert: state.server.cert + ca.cert, key };
    const issued = issueServerCertificate(ca, { ips, names });
    state.server = { cert: issued.cert, key: box.seal(issued.key), ips, names };
    save();
    return { cert: issued.cert + ca.cert, key: issued.key };
  }

  // Port really in use (the configured one, or the one the system picked for port 0).
  const currentPort = () => (listening && server?.address()?.port) || state.port;
  function urls() {
    const name = mdnsName(hostname());
    const port = currentPort();
    return [
      ...localAddresses(interfaces()).map((ip) =>
        net.isIPv6(ip) ? `https://[${ip}]:${port}/` : `https://${ip}:${port}/`,
      ),
      ...(name ? [`https://${name}:${port}/`] : []),
    ];
  }
  function status() {
    const live = pairing && pairing.expiresAt > now() ? pairing : null;
    return {
      enabled: state.enabled,
      running: listening,
      port: currentPort(),
      urls: listening ? urls() : [],
      error: lastError,
      certificateFingerprint: state.authority?.cert ? fingerprint(state.authority.cert) : null,
      encryptedKeys: state.authority?.key?.encrypted === 1,
      devices: state.devices.map(({ id, name, createdAt, lastSeenAt }) => ({
        id,
        name,
        createdAt,
        lastSeenAt,
      })),
      pairing: live ? { code: live.code, expiresAt: live.expiresAt } : null,
    };
  }

  // --- pairing and devices ---
  function startPairing() {
    if (!listening) throw new Error(messages("remote.notRunning"));
    pairing = { code: pairingCode(), expiresAt: now() + PAIRING_TTL_MS, attempts: 0 };
    changed();
    return { code: pairing.code, expiresAt: pairing.expiresAt, url: `${urls()[0] || ""}#pair=${pairing.code}` };
  }
  function cancelPairing() {
    pairing = null;
    changed();
  }
  function pair(code, deviceName) {
    if (!pairing || pairing.expiresAt <= now()) {
      pairing = null;
      return { ok: false, error: messages("remote.pairingExpired") };
    }
    const given = sha256(normalizeCode(code));
    if (!sameHash(given, sha256(pairing.code))) {
      pairing.attempts += 1;
      if (pairing.attempts >= PAIRING_ATTEMPTS) pairing = null;
      changed();
      return { ok: false, error: messages("remote.pairingWrongCode") };
    }
    pairing = null;
    const token = crypto.randomBytes(32).toString("base64url");
    const device = {
      id: crypto.randomUUID(),
      name:
        String(deviceName || "")
          .replace(/[\u0000-\u001f\u007f]/g, "")
          .trim()
          .slice(0, 60) || messages("remote.defaultDeviceName"),
      tokenHash: sha256(token).toString("hex"),
      createdAt: new Date(now()).toISOString(),
      lastSeenAt: new Date(now()).toISOString(),
    };
    state.devices.push(device);
    save();
    changed();
    return { ok: true, token, deviceId: device.id, deviceName: device.name };
  }
  function authenticate(header) {
    const token = typeof header === "string" ? header.replace(/^Bearer /, "") : "";
    if (!token || token.length > 200) return null;
    const hash = sha256(token);
    let found = null;
    for (const device of state.devices)
      if (sameHash(hash, Buffer.from(device.tokenHash, "hex"))) found = device;
    if (found) {
      const at = now();
      // Last seen, saved at most once a minute.
      if (!found.lastSeenAt || at - Date.parse(found.lastSeenAt) > 60_000) {
        found.lastSeenAt = new Date(at).toISOString();
        try {
          save();
        } catch {}
        changed();
      }
    }
    return found;
  }
  function revokeDevice(id) {
    const before = state.devices.length;
    state.devices = state.devices.filter((d) => d.id !== id);
    if (state.devices.length === before) return false;
    for (const [res, deviceId] of streams)
      if (deviceId === id) {
        res.end();
        streams.delete(res);
      }
    save();
    changed();
    return true;
  }

  // --- HTTP ---
  const securityHeaders = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  function json(res, status, body) {
    res.writeHead(status, {
      ...securityHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  }
  async function readJson(req, limit = MAX_BODY) {
    if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
      const error = new Error("Use application/json.");
      error.status = 415;
      throw error;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) {
        const error = new Error("Request exceeded the limit.");
        error.status = 413;
        throw error;
      }
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      const error = new Error("Invalid JSON.");
      error.status = 400;
      throw error;
    }
  }
  function serveStatic(res, pathname) {
    const relative =
      pathname === "/" || pathname === "/index.html" ? "mobile.html" : pathname.slice(1);
    if (
      !/^(?:mobile\.html|manifest\.webmanifest|(?:assets|brand|providers)\/[A-Za-z0-9._-]+)$/.test(relative)
    )
      return false;
    const full = path.join(staticDir, relative);
    if (!full.startsWith(path.resolve(staticDir) + path.sep)) return false;
    let data;
    try {
      data = fs.readFileSync(full);
    } catch {
      if (relative !== "mobile.html") return false;
      res.writeHead(503, { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" });
      res.end(messages("remote.interfaceMissing"));
      return true;
    }
    res.writeHead(200, {
      ...securityHeaders,
      "Content-Type": STATIC_TYPES[path.extname(full)] || "application/octet-stream",
      "Cache-Control": relative.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(data);
    return true;
  }

  async function handle(req, res) {
    if (!isPrivateAddress(req.socket.remoteAddress)) {
      req.socket.destroy();
      return;
    }
    if (!allowedHost(req.headers.host))
      return json(res, 421, { error: "Host not allowed." });
    const url = new URL(req.url, "https://localhost");
    if (
      req.method !== "GET" &&
      req.headers.origin &&
      req.headers.origin !== `https://${req.headers.host}`
    )
      return json(res, 403, { error: "Origin not allowed." });

    if (req.method === "GET" && url.pathname === "/beagledock-ca.crt") {
      res.writeHead(200, {
        ...securityHeaders,
        "Content-Type": "application/x-x509-ca-cert",
        "Content-Disposition": 'attachment; filename="BeagleDock.crt"',
        "Cache-Control": "no-store",
      });
      res.end(pemToDer(authority().cert));
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      if (req.method === "GET" && serveStatic(res, url.pathname)) return;
      return json(res, 404, { error: "Route not found." });
    }
    try {
      if (url.pathname === "/api/pair") {
        if (req.method !== "POST") return json(res, 405, { error: "Use POST." });
        // Before pairing, only a few bytes are accepted.
        const body = await readJson(req, 4096);
        const result = pair(body?.code, body?.name);
        return json(res, result.ok ? 200 : 403, result);
      }
      const device = authenticate(req.headers.authorization);
      if (!device) return json(res, 401, { error: messages("remote.notPaired") });
      if (url.pathname === "/api/events") {
        if (req.method !== "GET") return json(res, 405, { error: "Use GET." });
        res.writeHead(200, {
          ...securityHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });
        // Sent at once (not held for Nagle) so each live chunk reaches the phone as it is written.
        req.socket.setNoDelay?.(true);
        res.write(": connected\n\n");
        streams.set(res, device.id);
        // Also lets the phone notice a connection that died silently (it expects one regularly).
        const heartbeat = setInterval(() => send(res, ": heartbeat\n\n"), STREAM_HEARTBEAT_MS);
        res.on("close", () => {
          clearInterval(heartbeat);
          streams.delete(res);
        });
        return;
      }
      if (url.pathname === "/api/invoke") {
        if (req.method !== "POST") return json(res, 405, { error: "Use POST." });
        const body = await readJson(req);
        if (
          !body ||
          typeof body.method !== "string" ||
          !api.methods.includes(body.method) ||
          Object.keys(body).some((key) => !["method", "args"].includes(key)) ||
          (body.args !== undefined && (!Array.isArray(body.args) || body.args.length > 10))
        )
          return json(res, 400, { error: "Invalid method or arguments." });
        const result = await api.call(body.method, body.args || [], { id: device.id, name: device.name });
        return json(res, 200, { result: result ?? null });
      }
      return json(res, 404, { error: "Route not found." });
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.message });
    }
  }

  // `write()` returning false only means the socket buffer is past 16 KB, which one long reply chunk
  // already is: the stream is closed only when the phone has stopped reading what was queued.
  function send(res, message) {
    if (!streams.has(res)) return;
    if (res.writableLength > STREAM_BACKLOG_LIMIT) {
      // A phone that stops reading (screen off) doesn't hold up memory: it reconnects and reloads.
      streams.delete(res);
      res.destroy();
      return;
    }
    res.write(message);
  }

  // `except`: the device that caused the change (it already has it).
  function broadcast(channel, payload, { except } = {}) {
    if (!REMOTE_EVENTS.has(channel) || !streams.size) return;
    const message = `data: ${JSON.stringify({ channel, payload })}\n\n`;
    for (const [res, deviceId] of streams) if (deviceId !== except) send(res, message);
  }

  function start() {
    if (server) return Promise.resolve(status());
    lastError = null;
    let credentials;
    try {
      credentials = serverCredentials();
    } catch (error) {
      lastError = error.message;
      changed();
      return Promise.resolve(status());
    }
    const instance = https.createServer({ ...credentials, minVersion: "TLSv1.2" }, (req, res) => {
      handle(req, res).catch(() => {
        if (!res.headersSent) json(res, 500, { error: "Internal error." });
      });
    });
    // Connections from outside the private networks are dropped before the TLS handshake.
    instance.on("connection", (socket) => {
      if (!isPrivateAddress(socket.remoteAddress)) socket.destroy();
    });
    instance.on("tlsClientError", () => {});
    server = instance;
    return new Promise((resolve) => {
      instance.once("error", (error) => {
        server = null;
        listening = false;
        lastError =
          error.code === "EADDRINUSE"
            ? messages("remote.portInUse", { port: state.port })
            : error.message;
        log.warn?.("[remote-access]", error.message);
        changed();
        resolve(status());
      });
      instance.listen({ port: state.port, host: "::", ipv6Only: false }, () => {
        listening = true;
        changed();
        resolve(status());
      });
    });
  }
  function stop() {
    pairing = null;
    for (const res of streams.keys()) res.end();
    streams.clear();
    const instance = server;
    server = null;
    listening = false;
    if (!instance) return Promise.resolve(status());
    return new Promise((resolve) => {
      instance.close(() => resolve(status()));
      instance.closeAllConnections?.();
      changed();
    });
  }
  async function setEnabled(enabled) {
    state.enabled = !!enabled;
    save();
    return state.enabled ? start() : stop();
  }
  async function setPort(port) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error(messages("remote.invalidPort"));
    if (state.port === port && (!state.enabled || listening)) return status();
    await stop();
    state.port = port;
    lastError = null;
    save();
    if (state.enabled) return start();
    changed();
    return status();
  }

  // Settings changes wait for startup and each other before replacing the listener.
  let pending = Promise.resolve();
  function enqueue(action) {
    const result = pending.then(action);
    pending = result.catch(() => {});
    return result;
  }

  return {
    status,
    start: () => enqueue(() => (state.enabled ? start() : status())),
    stop: () => enqueue(stop),
    setEnabled: (enabled) => enqueue(() => setEnabled(enabled)),
    setPort: (port) => enqueue(() => setPort(port)),
    startPairing,
    cancelPairing,
    revokeDevice,
    broadcast,
    // Exposed for tests.
    address: () => server?.address() || null,
    handle,
    pair,
    authenticate,
    certificate: () => authority().cert,
  };
}

module.exports = {
  createRemoteAccess,
  localAddresses,
  allowedHost,
  mdnsName,
  REMOTE_EVENTS,
  DEFAULT_PORT,
};
