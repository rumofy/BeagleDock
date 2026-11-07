const test = require("node:test");
const assert = require("node:assert/strict");
const { createTerminalHistory, syncTerminalTurn } = require("../electron/terminal-history");

const msg = (id, sender, text, timestamp = "2026-11-03T20:00:00.000Z") => ({ id, sender, text, timestamp });

function setup({ conversations = {}, native = [], links = {}, now = 1_000_000 } = {}) {
  const saved = [], linked = [], emitted = [];
  let clock = now;
  const h = createTerminalHistory({
    readConversation: async (provider, id) => {
      const messages = conversations[`${provider}:${id}`];
      if (!messages) throw new Error("Conversation not found on disk.");
      return { messages: messages() };
    },
    listNative: async ({ exclude }) => native.filter((n) => !exclude.includes(`${n.provider}:${n.sessionId}`)),
    linkedIds: async () => Object.values(links),
    store: {
      setNativeSession: async (...args) => linked.push(args),
      saveChatMessage: async (m) => saved.push(m),
      sessionExists: async () => true,
    },
    emit: (channel, payload) => emitted.push([channel, payload]),
    now: () => clock,
  });
  return { h, saved, linked, emitted, tick: (ms) => (clock += ms) };
}

test("saves only what was said after the terminal opened, without repeating", async () => {
  let list = [msg("a", "user", "do chat"), msg("b", "claude", "resposta do chat")];
  const t = setup({ conversations: { "claude:native-1": () => list } });
  await t.h.begin({ sessionId: "s1", providerId: "claude", cwd: "/proj", nativeId: "native-1" });
  list = [...list, msg("c", "user", "pelo terminal"), msg("d", "claude", "**feito** no terminal")];
  const first = await t.h.sync("s1");
  assert.equal(first.added, 2);
  assert.equal(first.lastReply, "**feito** no terminal");
  assert.deepEqual(t.saved.map((m) => [m.id, m.sender, m.senderName, m.text]), [
    ["term-c", "user", "You", "pelo terminal"],
    ["term-d", "claude", "Claude Code", "**feito** no terminal"],
  ]);
  assert.equal(t.saved[0].createdAt, "2026-11-03 20:00:00.000", "the order follows the native conversation's time");
  assert.deepEqual(t.emitted, [["cli-terminal-history", { sessionId: "s1", added: 2, hasReply: true }]]);
  assert.equal((await t.h.sync("s1")).added, 0, "the second sync doesn't repeat");
  await t.h.end("s1");
  assert.equal(t.h.has("s1"), false);
  assert.equal(t.linked.length, 0, "an already linked conversation isn't linked again");
});

test("new Claude Code conversation: links the chosen ID only when the CLI saves the conversation", async () => {
  const conversations = {};
  const t = setup({ conversations });
  await t.h.begin({ sessionId: "s1", providerId: "claude", cwd: "/proj", newNativeId: "11111111-new" });
  assert.equal((await t.h.sync("s1")).added, 0);
  assert.equal(t.linked.length, 0, "opened and didn't talk: nothing is linked");
  conversations["claude:11111111-new"] = () => [msg("x", "user", "oi"), msg("y", "claude", "olá")];
  const result = await t.h.sync("s1");
  assert.equal(result.added, 2);
  assert.deepEqual(t.linked, [["s1", "claude", "11111111-new", "/proj"]]);
});

test("a new Codex and AGY conversation is found by the folder and the opening time", async () => {
  const conversations = { "codex:thread-novo": () => [msg("u", "user", "oi"), msg("r", "codex", "olá")] };
  const native = [
    { provider: "codex", sessionId: "thread-antigo", project: "/proj", timestampMs: 1_000_000 - 60_000 },
    { provider: "codex", sessionId: "thread-outra-pasta", project: "/outra", timestampMs: 1_000_000 + 1000 },
    { provider: "antigravity", sessionId: "agy-x", project: "/proj", timestampMs: 1_000_000 + 1000 },
    { provider: "codex", sessionId: "thread-de-outra-conversa", project: "/proj", timestampMs: 1_000_000 + 3000 },
    { provider: "codex", sessionId: "thread-novo", project: "/proj", timestampMs: 1_000_000 + 2000 },
  ];
  const t = setup({ conversations, native, links: { other: "codex:thread-de-outra-conversa" } });
  await t.h.begin({ sessionId: "s1", providerId: "codex", cwd: "/proj" });
  const result = await t.h.sync("s1");
  assert.equal(result.nativeId, "thread-novo");
  assert.deepEqual(t.linked, [["s1", "codex", "thread-novo", "/proj"]]);
  assert.deepEqual(t.saved.map((m) => [m.id, m.senderName]), [["term-u", "You"], ["term-r", "Codex CLI"]]);
});

test("a sync requested during the opening waits for the initial snapshot", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const list = [msg("a", "user", "do chat")];
  const saved = [];
  const h = createTerminalHistory({
    readConversation: async () => (await gate, { messages: list }),
    listNative: async () => [],
    store: { setNativeSession: async () => {}, saveChatMessage: async (m) => saved.push(m) },
  });
  const opening = h.begin({ sessionId: "s1", providerId: "antigravity", cwd: "/proj", nativeId: "conv_1234567" });
  const syncing = h.sync("s1");
  release();
  await opening;
  assert.equal((await syncing).added, 0, "what came from the chat isn't imported again");
  assert.deepEqual(saved, []);
});

for (const providerId of ["claude", "codex", "antigravity"]) {
  test(`${providerId}: an old retry cannot consume the next turn's completed reply`, async () => {
    let messages = [];
    const t = setup({ conversations: { [`${providerId}:native-1`]: () => messages } });
    await t.h.begin({ sessionId: "s1", providerId, cwd: "/proj", nativeId: "native-1" });
    let revision = 1;
    const waits = [];
    const wait = (ms) => new Promise((resolve) => waits.push({ ms, resolve }));
    const old = syncTerminalTurn({ sessionId: "s1", history: t.h, isCurrent: () => revision === 1, wait });
    waits.shift().resolve();
    await new Promise(setImmediate);
    assert.equal(waits[0].ms, 1500, "the previous turn has a retry pending");
    revision = 2;
    const current = syncTerminalTurn({ sessionId: "s1", history: t.h, isCurrent: () => revision === 2, wait });
    messages = [msg("u2", "user", "next request"), msg("r2", providerId, "next reply")];
    waits.shift().resolve();
    assert.equal(await old, null, "the stale retry exits before importing the new reply");
    assert.equal(t.saved.length, 0);
    waits.shift().resolve();
    assert.equal((await current).lastReply, "next reply");
    assert.deepEqual(t.saved.map((m) => m.id), ["term-u2", "term-r2"]);
  });
}

test("a turn invalidated during an in-flight history read leaves the new reply for the current sync", async () => {
  let releaseRead, startRead;
  const enteredRead = new Promise((resolve) => { startRead = resolve; });
  const pendingRead = new Promise((resolve) => { releaseRead = resolve; });
  let deferred = false;
  let messages = [];
  const saved = [];
  const history = createTerminalHistory({
    readConversation: async () => {
      if (deferred) { startRead(); await pendingRead; }
      return { messages };
    },
    store: { saveChatMessage: async (message) => saved.push(message) },
  });
  await history.begin({ sessionId: "s1", providerId: "codex", cwd: "/proj", nativeId: "native-1" });
  deferred = true;
  let revision = 1;
  const old = syncTerminalTurn({ sessionId: "s1", history, isCurrent: () => revision === 1, wait: async () => {} });
  await enteredRead;
  revision = 2;
  messages = [msg("u2", "user", "next request"), msg("r2", "codex", "next reply")];
  const current = syncTerminalTurn({ sessionId: "s1", history, isCurrent: () => revision === 2, wait: async () => {} });
  releaseRead();
  assert.equal(await old, null);
  assert.equal((await current).lastReply, "next reply");
  assert.deepEqual(saved.map((m) => m.id), ["term-u2", "term-r2"]);
});

test("an invalidated history sync queued during opening imports no new messages", async () => {
  let releaseRead;
  const gate = new Promise((resolve) => { releaseRead = resolve; });
  let messages = [];
  const saved = [];
  const history = createTerminalHistory({
    readConversation: async () => { await gate; return { messages }; },
    store: { saveChatMessage: async (message) => saved.push(message) },
  });
  const opening = history.begin({ sessionId: "s1", providerId: "claude", cwd: "/proj", nativeId: "native-1" });
  let current = true;
  const queued = history.sync("s1", () => current);
  current = false;
  releaseRead();
  await opening;
  messages = [msg("u2", "user", "next request"), msg("r2", "claude", "next reply")];
  assert.equal((await queued).added, 0);
  assert.equal(saved.length, 0);
  assert.equal((await history.sync("s1")).lastReply, "next reply");
});
