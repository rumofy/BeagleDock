const test = require("node:test");
const assert = require("node:assert/strict");
const { chatReplyNotice, terminalTurnNotice } = require("../electron/reply-notices");
const { SEGMENT_SEPARATOR } = require("../electron/message-segments");

test("chat: notifies the end and the failure of the requested reply, in the three CLIs", () => {
  assert.deepEqual(chatReplyNotice("claude", { ok: true, output: `Vou ver.${SEGMENT_SEPARATOR}Pronto,\n  testes   passando.` }), {
    title: "Claude Code replied",
    body: "Vou ver. Pronto, testes passando.",
  });
  assert.deepEqual(chatReplyNotice("codex", { ok: false, error: "Limite de uso atingido." }), {
    title: "Codex CLI · the reply failed",
    body: "Limite de uso atingido.",
  });
  assert.equal(chatReplyNotice("antigravity", { ok: true, output: "" }).body, "Run finished.");
  assert.equal(chatReplyNotice("claude", { ok: true, output: "x".repeat(500) }).body.length, 140);
  // With messages delivered midway, the notice carries the last reply.
  assert.equal(
    chatReplyNotice("claude", { ok: true, output: "antes", followUps: [{ text: "a" }, { text: "resposta final" }] }).body,
    "resposta final",
  );
});

test("chat: delivered midway, cancelled, stopped or discarded doesn't notify", () => {
  for (const result of [{ ok: true, injected: true }, { cancelled: true }, { ok: true, stopped: true }, { discarded: true }, null])
    assert.equal(chatReplyNotice("claude", result), null);
});

test("terminal: notifies with the end of the reply or that the CLI is waiting for you", () => {
  assert.deepEqual(terminalTurnNotice("antigravity", "GIRASSOL"), {
    title: "Antigravity · your turn in the terminal",
    body: "GIRASSOL",
  });
  assert.equal(terminalTurnNotice("claude", "").body, "The reply finished or the CLI is waiting for you.");
});
