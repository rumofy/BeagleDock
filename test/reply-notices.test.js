const test = require("node:test");
const assert = require("node:assert/strict");
const { chatReplyNotice, terminalTurnNotice } = require("../electron/reply-notices");
const { SEGMENT_SEPARATOR } = require("../electron/message-segments");

test("chat: avisa o fim e a falha da resposta pedida, nas três CLIs", () => {
  assert.deepEqual(chatReplyNotice("claude", { ok: true, output: `Vou ver.${SEGMENT_SEPARATOR}Pronto,\n  testes   passando.` }), {
    title: "Claude Code respondeu",
    body: "Vou ver. Pronto, testes passando.",
  });
  assert.deepEqual(chatReplyNotice("codex", { ok: false, error: "Limite de uso atingido." }), {
    title: "Codex CLI · a resposta falhou",
    body: "Limite de uso atingido.",
  });
  assert.equal(chatReplyNotice("antigravity", { ok: true, output: "" }).body, "Execução concluída.");
  assert.equal(chatReplyNotice("claude", { ok: true, output: "x".repeat(500) }).body.length, 140);
  // Com mensagens entregues no meio, o aviso traz a última resposta.
  assert.equal(
    chatReplyNotice("claude", { ok: true, output: "antes", followUps: [{ text: "a" }, { text: "resposta final" }] }).body,
    "resposta final",
  );
});

test("chat: entregue no meio, cancelada, parada ou descartada não avisa", () => {
  for (const result of [{ ok: true, injected: true }, { cancelled: true }, { ok: true, stopped: true }, { discarded: true }, null])
    assert.equal(chatReplyNotice("claude", result), null);
});

test("terminal: avisa com o fim da resposta ou que a CLI espera você", () => {
  assert.deepEqual(terminalTurnNotice("antigravity", "GIRASSOL"), {
    title: "Antigravity · sua vez no terminal",
    body: "GIRASSOL",
  });
  assert.equal(terminalTurnNotice("claude", "").body, "A resposta terminou ou a CLI espera você.");
});
