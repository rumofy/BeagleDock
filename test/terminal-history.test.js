const test = require("node:test");
const assert = require("node:assert/strict");
const { createTerminalHistory } = require("../electron/terminal-history");

const msg = (id, sender, text, timestamp = "2026-11-03T20:00:00.000Z") => ({ id, sender, text, timestamp });

function setup({ conversations = {}, native = [], links = {}, now = 1_000_000 } = {}) {
  const saved = [], linked = [], emitted = [];
  let clock = now;
  const h = createTerminalHistory({
    readConversation: async (provider, id) => {
      const messages = conversations[`${provider}:${id}`];
      if (!messages) throw new Error("Conversa não encontrada no disco.");
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

test("grava só o que foi conversado depois de o terminal abrir, sem repetir", async () => {
  let list = [msg("a", "user", "do chat"), msg("b", "claude", "resposta do chat")];
  const t = setup({ conversations: { "claude:native-1": () => list } });
  await t.h.begin({ sessionId: "s1", providerId: "claude", cwd: "/proj", nativeId: "native-1" });
  list = [...list, msg("c", "user", "pelo terminal"), msg("d", "claude", "**feito** no terminal")];
  const first = await t.h.sync("s1");
  assert.equal(first.added, 2);
  assert.equal(first.lastReply, "**feito** no terminal");
  assert.deepEqual(t.saved.map((m) => [m.id, m.sender, m.senderName, m.text]), [
    ["term-c", "user", "Você", "pelo terminal"],
    ["term-d", "claude", "Claude Code", "**feito** no terminal"],
  ]);
  assert.equal(t.saved[0].createdAt, "2026-11-03 20:00:00.000", "a ordem segue a hora da conversa nativa");
  assert.deepEqual(t.emitted, [["cli-terminal-history", { sessionId: "s1", added: 2 }]]);
  assert.equal((await t.h.sync("s1")).added, 0, "a segunda sincronização não repete");
  await t.h.end("s1");
  assert.equal(t.h.has("s1"), false);
  assert.equal(t.linked.length, 0, "conversa já ligada não é religada");
});

test("conversa nova do Claude Code: liga o ID escolhido só quando a CLI grava a conversa", async () => {
  const conversations = {};
  const t = setup({ conversations });
  await t.h.begin({ sessionId: "s1", providerId: "claude", cwd: "/proj", newNativeId: "11111111-new" });
  assert.equal((await t.h.sync("s1")).added, 0);
  assert.equal(t.linked.length, 0, "abriu e não conversou: nada é ligado");
  conversations["claude:11111111-new"] = () => [msg("x", "user", "oi"), msg("y", "claude", "olá")];
  const result = await t.h.sync("s1");
  assert.equal(result.added, 2);
  assert.deepEqual(t.linked, [["s1", "claude", "11111111-new", "/proj"]]);
});

test("conversa nova do Codex e do AGY é achada pela pasta e pela hora de abertura", async () => {
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
  assert.deepEqual(t.saved.map((m) => [m.id, m.senderName]), [["term-u", "Você"], ["term-r", "Codex CLI"]]);
});

test("sincronização pedida durante a abertura espera o retrato inicial", async () => {
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
  assert.equal((await syncing).added, 0, "o que veio do chat não é importado de novo");
  assert.deepEqual(saved, []);
});
