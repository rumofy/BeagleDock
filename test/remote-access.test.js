const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const {
  createAuthority,
  issueServerCertificate,
  serverCertificateFits,
  isPrivateAddress,
} = require("../electron/remote-cert");
const { createRemoteAccess, allowedHost, localAddresses, mdnsName } = require("../electron/remote-access");
const { createRemoteApi, METHODS } = require("../electron/remote-api");
const { createClientSync } = require("../electron/client-sync");
const { loadTs } = require("./load-ts.cjs");

// Values built in the TypeScript modules' VM context: compared by structure.
const plain = (value) => JSON.parse(JSON.stringify(value));
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-remote-"));

test("the local authority signs server certificates for the computer's addresses", () => {
  const ca = createAuthority();
  const server = issueServerCertificate(ca, { ips: ["192.168.1.20", "fe80::1"], names: ["box.local"] });
  const caCert = new crypto.X509Certificate(ca.cert);
  const cert = new crypto.X509Certificate(server.cert);
  assert.equal(caCert.ca, true);
  assert.equal(cert.ca, false);
  assert.ok(cert.verify(caCert.publicKey));
  assert.ok(cert.checkIssued(caCert));
  assert.equal(cert.checkIP("192.168.1.20"), "192.168.1.20");
  assert.equal(cert.checkHost("box.local"), "box.local");
  // Apple only trusts server certificates valid for up to 825 days.
  const days = (Date.parse(cert.validTo) - Date.parse(cert.validFrom)) / 86400000;
  assert.ok(days <= 400, `valid for ${days} days`);
  assert.ok(serverCertificateFits(server, ["192.168.1.20"], ["box.local"]));
  assert.equal(serverCertificateFits(server, ["10.0.0.9"], []), false, "a new address needs a new certificate");
});

// TLS handshake against a server certificate issued for `ips`, trusting only the local authority.
async function handshake(ca, ips, names = []) {
  const tls = require("node:tls");
  const server = issueServerCertificate(ca, { ips, names });
  const listener = tls.createServer({ cert: server.cert + ca.cert, key: server.key }, (socket) => socket.end());
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  try {
    return await new Promise((resolve) => {
      const socket = tls.connect(
        { host: "127.0.0.1", port: listener.address().port, ca: ca.cert, checkServerIdentity: () => undefined },
        () => {
          socket.end();
          resolve("ok");
        },
      );
      socket.on("error", (error) => resolve(error.code || error.message));
    });
  } finally {
    listener.close();
  }
}

test("the authority's name constraints stop it from vouching for internet domains", async () => {
  const ca = createAuthority();
  assert.equal(await handshake(ca, ["127.0.0.1", "192.168.0.2"], ["localhost", "box.local"]), "ok");
  assert.notEqual(await handshake(ca, [], ["example.com"]), "ok", "a leaked key still can't impersonate a website");
  assert.notEqual(await handshake(ca, [], ["bank.example.local.example.com"]), "ok");
});

test("only private and loopback addresses count as the local network", () => {
  for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "127.0.0.1", "::1", "::ffff:192.168.1.5", "fe80::1%wlan0", "fd12::1", "100.100.1.1"])
    assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2001:4860::8888", "::ffff:8.8.8.8", "", undefined, "not-an-ip"])
    assert.equal(isPrivateAddress(ip), false, String(ip));
  assert.ok(allowedHost("192.168.1.20:47821"));
  assert.ok(allowedHost("[fe80::1]:47821"));
  assert.ok(allowedHost("my-box.local:47821"));
  assert.equal(allowedHost("evil.example.com"), false, "DNS rebinding with a public name");
  assert.equal(allowedHost("8.8.8.8:47821"), false);
  assert.equal(allowedHost(undefined), false);
  assert.deepEqual(
    localAddresses({
      lo: [{ address: "127.0.0.1", internal: true }],
      wlan0: [
        { address: "fd00::5", internal: false },
        { address: "192.168.0.7", internal: false },
        { address: "fe80::1", internal: false },
      ],
      wan: [{ address: "203.0.113.4", internal: false }],
      docker0: [{ address: "172.17.0.1", internal: false }],
      "br-1a2b3c": [{ address: "172.19.0.1", internal: false }],
    }),
    ["192.168.0.7", "fd00::5"],
  );
  assert.equal(mdnsName("Gui-Desktop.lan"), "gui-desktop.local");
});

function fakeApi() {
  const calls = [];
  return {
    calls,
    methods: ["getOverview", "sendMessage"],
    call: async (method, args, device) => {
      calls.push({ method, args, device });
      return { ok: true, method };
    },
  };
}

test("pairing takes a one-time code, gives up after 5 wrong attempts and tokens can be revoked", async () => {
  let clock = Date.now();
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "remote-access.json"), JSON.stringify({ port: 0 }));
  const remote = createRemoteAccess({ dir, api: fakeApi(), staticDir: tempDir(), now: () => clock });
  assert.throws(() => remote.startPairing(), /remote\.notRunning/, "pairing needs the server running");
  await remote.setEnabled(true);
  try {
    assert.equal(remote.pair("ANYCODE1", "x").ok, false, "no code issued yet");
    const { code, url } = remote.startPairing();
    assert.match(code, /^[A-Z2-9]{8}$/);
    assert.match(url, new RegExp(`#pair=${code}$`));
    for (let i = 0; i < 4; i++) assert.equal(remote.pair("WRONG000", "x").ok, false);
    const ok = remote.pair(code.toLowerCase().replace(/^(....)/, "$1-"), "  iPhone\u0007 ");
    assert.equal(ok.ok, true, "code is case and dash insensitive");
    assert.equal(ok.deviceName, "iPhone");
    assert.equal(remote.pair(code, "again").ok, false, "a code pairs a single device");
    const device = remote.authenticate(`Bearer ${ok.token}`);
    assert.equal(device?.id, ok.deviceId);
    assert.equal(remote.authenticate("Bearer nope"), null);
    const saved = fs.readFileSync(path.join(dir, "remote-access.json"), "utf8");
    assert.equal(saved.includes(ok.token), false, "only the token hash is stored");

    const second = remote.startPairing();
    for (let i = 0; i < 5; i++) remote.pair("WRONG000", "x");
    assert.equal(remote.pair(second.code, "x").ok, false, "five wrong attempts burn the code");

    const third = remote.startPairing();
    clock += 5 * 60 * 1000 + 1;
    assert.equal(remote.pair(third.code, "x").ok, false, "codes expire after five minutes");

    assert.equal(remote.revokeDevice(ok.deviceId), true);
    assert.equal(remote.authenticate(`Bearer ${ok.token}`), null);
  } finally {
    await remote.stop();
  }
});

function request(port, ca, method, pathname, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: "127.0.0.1", port, method, path: pathname, ca, servername: "localhost", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json, raw: Buffer.concat(chunks) });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

test("the HTTPS server verifies against the local authority, pairs, authenticates and streams only chat events", async (t) => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "remote-access.json"), JSON.stringify({ enabled: true, port: 0 }));
  const staticDir = tempDir();
  fs.writeFileSync(path.join(staticDir, "mobile.html"), "<!doctype html><title>phone</title>");
  fs.writeFileSync(path.join(staticDir, "secret.txt"), "nope");
  const api = fakeApi();
  const remote = createRemoteAccess({ dir, api, staticDir });
  await remote.start();
  t.after(() => remote.stop());
  const status = remote.status();
  assert.equal(status.running, true, status.error || "");
  const { port } = remote.address();
  const ca = remote.certificate();

  // Untrusted without the authority: the phone must install it first.
  await assert.rejects(
    new Promise((resolve, reject) =>
      https.get({ host: "127.0.0.1", port, path: "/" }, resolve).on("error", reject),
    ),
  );
  const page = await request(port, ca, "GET", "/");
  assert.equal(page.status, 200);
  assert.match(page.text, /phone/);
  assert.equal(page.headers["x-frame-options"], "DENY");
  assert.equal((await request(port, ca, "GET", "/secret.txt")).status, 404, "only the phone interface is served");
  assert.equal((await request(port, ca, "GET", "/assets/../secret.txt")).status, 404);

  const der = await request(port, ca, "GET", "/beagledock-ca.crt");
  assert.equal(der.headers["content-type"], "application/x-x509-ca-cert");
  assert.equal(new crypto.X509Certificate(der.raw).fingerprint256, status.certificateFingerprint);

  assert.equal((await request(port, ca, "GET", "/", { headers: { Host: "attacker.example" } })).status, 421);
  assert.equal((await request(port, ca, "POST", "/api/invoke", { body: { method: "getOverview" } })).status, 401);
  assert.equal((await request(port, ca, "GET", "/api/events")).status, 401);

  const wrong = await request(port, ca, "POST", "/api/pair", { body: { code: "WRONG000", name: "x" } });
  assert.equal(wrong.status, 403);
  const { code } = remote.startPairing();
  const paired = await request(port, ca, "POST", "/api/pair", { body: { code, name: "Test phone" } });
  assert.equal(paired.status, 200);
  const auth = { Authorization: `Bearer ${paired.json.token}` };

  const ok = await request(port, ca, "POST", "/api/invoke", { headers: auth, body: { method: "getOverview", args: [] } });
  assert.deepEqual(ok.json, { result: { ok: true, method: "getOverview" } });
  assert.equal(api.calls[0].device.name, "Test phone");
  for (const body of [
    { method: "ptySpawn", args: [] },
    { method: "getOverview", args: {} },
    { method: "getOverview", extra: 1 },
  ])
    assert.equal((await request(port, ca, "POST", "/api/invoke", { headers: auth, body })).status, 400, JSON.stringify(body));
  assert.equal(
    (await request(port, ca, "POST", "/api/invoke", { headers: { ...auth, Origin: "https://evil.example" }, body: { method: "getOverview" } })).status,
    403,
  );
  assert.equal(
    (await request(port, ca, "POST", "/api/invoke", { headers: { ...auth, "Content-Type": "text/plain" }, body: "{}" })).status,
    415,
  );

  // Live events: the chat stream arrives, the terminal output never does.
  const received = [];
  let closed = false;
  const stream = await new Promise((resolve, reject) => {
    const req = https.get({ host: "127.0.0.1", port, path: "/api/events", ca, headers: auth }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => received.push(chunk));
      res.on("end", () => (closed = true));
      resolve({ res, req });
    });
    req.on("error", reject);
  });
  assert.equal(stream.res.statusCode, 200);
  remote.broadcast("pty-data", { sessionId: "s", data: "rm -rf" });
  remote.broadcast("cli-terminal-data", { sessionId: "s", data: "x" });
  remote.broadcast("cli-stream-chunk", { sessionId: "s", responseMessageId: "r", fullText: "partial" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const text = received.join("");
  assert.match(text, /"partial"/, "intermediate text arrives before the turn ends");
  assert.doesNotMatch(text, /rm -rf|cli-terminal-data/);

  // Revoking closes the open stream and the token stops working.
  remote.revokeDevice(paired.json.deviceId);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(closed, true);
  assert.equal((await request(port, ca, "POST", "/api/invoke", { headers: auth, body: { method: "getOverview" } })).status, 401);
});

test("the server stays off by default and survives a busy port", async (t) => {
  const remote = createRemoteAccess({ dir: tempDir(), api: fakeApi(), staticDir: tempDir() });
  const status = await remote.start();
  assert.equal(status.enabled, false);
  assert.equal(status.running, false);
  assert.equal(remote.address(), null);

  const blocker = https.createServer();
  await new Promise((resolve) => blocker.listen(0, "::", resolve));
  t.after(() => blocker.close());
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "remote-access.json"), JSON.stringify({ enabled: true, port: blocker.address().port }));
  const busy = createRemoteAccess({ dir, api: fakeApi(), staticDir: tempDir(), messages: (key, p) => `${key}:${p?.port ?? ""}` });
  const result = await busy.start();
  assert.equal(result.running, false);
  assert.equal(result.error, `remote.portInUse:${blocker.address().port}`);
});

function remoteApi() {
  const invoked = [];
  const api = createRemoteApi({
    invoke: async (channel, args, deviceId) => {
      invoked.push({ channel, args, deviceId });
      return channel === "load-full-conversation" ? { cwd: "/home/me/imported", messages: [] } : { ok: true };
    },
    getWorkspaces: async () => [{ id: "w1", name: "Proj", path: "/home/me/proj" }],
    getSessions: async () => [{ id: "s1", providerId: "claude", cwd: "/home/me/proj" }, { id: "s2", providerId: "codex", cwd: "/srv/legacy" }],
  });
  return { api, invoked };
}
const device = { id: "dev-1", name: "iPhone" };

test("the phone calls the desktop's own handlers, from an allowlist that leaves out the terminal and settings", async () => {
  const { api, invoked } = remoteApi();
  await api.call("getSavedState", [], device);
  await api.call("resolveCliApproval", ["ap1", "allow"], device);
  assert.deepEqual(invoked.map((c) => [c.channel, c.deviceId]), [
    ["get-saved-state", "dev-1"],
    ["resolve-cli-approval", "dev-1"],
  ]);
  for (const method of ["ptySpawn", "cliTerminalOpen", "updateCli", "saveWorkspace", "pickDirectory", "openInEditor", "runAIMemoryCommand", "saveGlobalPermissions", "downloadDictationModel"])
    await assert.rejects(api.call(method, [], device), /Unknown method/, method);
  await assert.rejects(api.call("getSavedState", {}, device), /Invalid arguments/);
  // Settings: only the chat's remembered choices.
  await api.call("saveAppSettings", [{ lastSessionChoices: { claude: {} } }], device);
  await assert.rejects(api.call("saveAppSettings", [{ theme: "dark" }], device), /remote\.settingsOnDesktop/);
  await assert.rejects(api.call("saveAppSettings", [{ lastSessionChoices: {}, customEndpoint: "x" }], device));
});

test("the phone only works in registered projects or in the conversation's own folder", async () => {
  const { api, invoked } = remoteApi();
  await api.call("saveSession", [{ id: "new", cwd: "/home/me/proj" }], device);
  await api.call("saveSession", [{ id: "s2", cwd: "/srv/legacy", title: "renamed" }], device);
  await assert.rejects(api.call("saveSession", [{ id: "new2", cwd: "/etc" }], device), /remote\.folderNotAllowed/);
  await assert.rejects(api.call("saveSession", [{ id: "s1", cwd: "/" }], device), "a conversation can't move to another folder");
  await api.call("executeCliPrompt", [{ sessionId: "s1", cwd: "/home/me/proj/", prompt: "hi" }], device);
  await assert.rejects(api.call("executeCliPrompt", [{ sessionId: "s1", cwd: "/tmp", prompt: "hi" }], device));
  await assert.rejects(api.call("executeCliPrompt", [{ sessionId: "missing", cwd: "/home/me/proj", prompt: "hi" }], device));
  await assert.rejects(api.call("searchProjectFiles", [{ cwd: "/", query: "passwd" }], device));
  await api.call("searchProjectFiles", [{ cwd: "/srv/legacy", query: "x" }], device);
  // Reopening a conversation from the CLI history keeps its original folder.
  await assert.rejects(api.call("saveSession", [{ id: "imp", cwd: "/home/me/imported" }], device));
  await api.call("loadFullConversation", ["claude", "native-1"], device);
  await api.call("saveSession", [{ id: "imp", cwd: "/home/me/imported" }], device);
  await assert.rejects(api.call("saveSession", [{ id: "imp", cwd: "/home/me/imported" }], { id: "other-device" }), "per device");
  assert.equal(invoked.filter((c) => c.channel === "execute-cli-prompt").length, 1);
});

test("the phone exposes exactly the methods the server allows", () => {
  const { REMOTE_METHODS } = loadTs("src/features/mobile/remoteBridge.ts", { globals: { window: {}, document: { addEventListener() {}, removeEventListener() {} } } });
  assert.deepEqual([...REMOTE_METHODS].sort(), Object.keys(METHODS).sort());
});

test("a change on one screen reaches the others: live turns, messages and conversations", async () => {
  const sent = [];
  let active = [];
  const sync = createClientSync({ emitOthers: (origin, channel, payload) => sent.push([origin, channel, payload]), activeIds: () => active });
  const payload = { sessionId: "s1", responseMessageId: "r1", providerId: "codex", model: "m" };
  let finish;
  const run = sync.run("dev-1", "execute-cli-prompt", [payload], () => new Promise((resolve) => (finish = resolve)));
  assert.deepEqual(sent, [["dev-1", "cli-turn-started", { sessionId: "s1", responseMessageId: "r1", providerId: "codex", model: "m" }]], "the others see the reply start live");
  finish({ ok: true, output: "done", events: [{ id: "e" }] });
  await run;
  assert.deepEqual(sent.slice(1), [
    ["dev-1", "cli-turn-finished", { sessionId: "s1", responseMessageId: "r1", providerId: "codex", ok: true, text: "done", error: undefined, events: [{ id: "e" }], model: "m" }],
    ["dev-1", "chat-sync", { kind: "messages", sessionId: "s1", active: false }],
  ]);

  sent.length = 0;
  await sync.run("desktop", "execute-cli-prompt", [payload], async () => ({ ok: false, injected: true }));
  assert.deepEqual(sent.map((e) => e[1]), ["cli-turn-started", "chat-sync"], "delivered mid-reply: the reply keeps streaming");
  sent.length = 0;
  await sync.run("desktop", "execute-cli-prompt", [payload], async () => ({ ok: false, cancelled: true }));
  assert.equal(sent[1][2].discard, true, "taken off the queue: the bubble goes away");
  sent.length = 0;
  await sync.run("desktop", "execute-cli-prompt", [payload], async () => ({ ok: false, stopped: true, cancelled: true, output: "partial" }));
  assert.deepEqual([sent[1][2].ok, sent[1][2].text], [true, "partial"], "stopped: what came out, not an error");

  sent.length = 0;
  active = ["s1"];
  await sync.run("desktop", "save-chat-message", [{ id: "m", sessionId: "s1" }], async () => ({ success: true }));
  await sync.run("dev-1", "save-session", [{ id: "s9" }], async () => ({ success: true }));
  await sync.run("dev-1", "set-session-archived", ["s9", true], async () => ({ success: true }));
  await sync.run("dev-1", "get-chat-messages", ["s1"], async () => []);
  await assert.rejects(sync.run("dev-1", "interrupt-cli-session", ["s1"], async () => { throw new Error("boom"); }));
  assert.deepEqual(sent, [
    ["desktop", "chat-sync", { kind: "messages", sessionId: "s1", active: true }],
    ["dev-1", "chat-sync", { kind: "sessions", sessionId: "s9" }],
    ["dev-1", "chat-sync", { kind: "sessions", sessionId: "s9" }],
    ["dev-1", "chat-sync", { kind: "messages", sessionId: "s1", active: true }],
  ], "reads don't notify; a failed change still makes the others reload");
});

test("the phones follow the theme and language chosen on the desktop", async () => {
  const sent = [];
  const sync = createClientSync({ emitOthers: (origin, channel, payload) => sent.push([origin, channel, payload]) });
  const saved = { success: true, settings: { theme: "dark", language: "pt-BR", defaultProvider: "claude" } };
  await sync.run("desktop", "save-app-settings", [{ theme: "dark" }], async () => saved);
  await sync.run("desktop", "save-app-settings", [{ autoCompactTokens: 1 }], async () => saved);
  await sync.run("desktop", "save-app-settings", [{ language: "es" }], async () => ({ success: false }));
  assert.deepEqual(sent, [["desktop", "chat-sync", { kind: "settings", settings: { theme: "dark", language: "pt-BR" } }]]);
});

test("reloading after another screen's change keeps the replies still arriving here", () => {
  const { mergeLive, mergeSessions } = loadTs("src/lib/liveMessages.ts");
  const saved = [{ id: "u1", text: "hi" }, { id: "r1", text: "saved" }];
  const live = [{ id: "r1", text: "partial", isStreaming: true }, { id: "r2", text: "next", isStreaming: true }];
  assert.deepEqual(plain(mergeLive(saved, live, true).map((m) => m.text)), ["hi", "partial", "next"]);
  assert.deepEqual(plain(mergeLive(saved, live, false).map((m) => m.text)), ["hi", "saved", "next"], "finished: the saved reply wins");
  assert.equal(mergeLive(saved, [{ id: "x", text: "old" }], false), saved);

  const merged = mergeSessions(
    [{ id: "a", title: "Old", ptyLog: ["$ ls"], status: "running", pid: 7 }, { id: "gone", title: "x" }],
    [{ id: "a", title: "New", ptyLog: [], status: "idle" }, { id: "b", title: "Created on the phone" }],
  );
  assert.deepEqual(plain(merged), [
    { id: "a", title: "New", ptyLog: ["$ ls"], status: "running", pid: 7 },
    { id: "b", title: "Created on the phone" },
  ]);
});

test("pairing links and device names", () => {
  const state = loadTs("src/features/mobile/mobileState.ts");
  assert.equal(state.pairingCodeFromHash("#pair=abcd2345"), "ABCD2345");
  assert.equal(state.pairingCodeFromHash("#other=1"), "");
  assert.equal(state.suggestedDeviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "iPhone");
});
