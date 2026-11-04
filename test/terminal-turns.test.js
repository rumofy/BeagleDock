const test = require("node:test");
const assert = require("node:assert/strict");
const { createTurnWatcher } = require("../electron/terminal-turns");

// Relógio e temporizadores manuais: o silêncio do AGY é medido sem esperar de verdade.
function clock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      const timer = { at: t + ms, fn, done: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => timer && (timer.done = true),
    advance(ms) {
      t += ms;
      for (const timer of timers)
        if (!timer.done && timer.at <= t) {
          timer.done = true;
          timer.fn();
        }
    },
  };
}
const title = (text) => `\x1b]0;${text}\x07`;

test("Claude Code: o spinner no título marca o trabalho e o ✳ marca o fim (ou a espera por você)", () => {
  const c = clock();
  const ends = [];
  const w = createTurnWatcher({ providerId: "claude", onTurnEnd: (e) => ends.push(e), ...c });
  w.output(title("✳ Claude Code"));
  assert.equal(ends.length, 0, "a abertura não é resposta");
  w.input("rode os testes\r");
  w.output(title("◐ Claude Code"));
  c.advance(5000);
  w.output("\x1b[2Kspinner" + title("◑ Shell npm test"));
  c.advance(1000);
  w.output(title("✳ Shell npm test"));
  assert.equal(ends.length, 1);
  assert.equal(ends[0].startedAt, 0);
  w.output(title("✳ Shell npm test"));
  assert.equal(ends.length, 1, "o mesmo título de novo não avisa outra vez");
  // Resposta espontânea (agente em segundo plano terminou): sem Enter, também conta.
  w.output(title("◒ Claude Code"));
  c.advance(2000);
  w.output(title("✳ Claude Code"));
  assert.equal(ends.length, 2);
});

test("Claude Code: título cortado entre dois pedaços de saída e trabalho curto demais", () => {
  const c = clock();
  const ends = [];
  const w = createTurnWatcher({ providerId: "claude", onTurnEnd: (e) => ends.push(e), ...c });
  w.output(title("◐ x"));
  c.advance(3000);
  const done = title("✳ x");
  w.output(done.slice(0, 5));
  w.output(done.slice(5));
  assert.equal(ends.length, 1);
  w.output(title("◐ x"));
  c.advance(100);
  w.output(title("✳ x"));
  assert.equal(ends.length, 1, "redesenho rápido não é resposta");
});

test("Codex CLI: o estado OSC 7501 só conta depois de você enviar algo", () => {
  const c = clock();
  const ends = [];
  const w = createTurnWatcher({ providerId: "codex", onTurnEnd: (e) => ends.push(e), ...c });
  // Abertura real: passa por working (servidores MCP) e volta a idle sozinho.
  w.output("\x1b]7501;state=idle:app=codex\x07");
  w.output("\x1b]7501;state=working:app=codex\x07");
  c.advance(3000);
  w.output("\x1b]7501;state=idle:app=codex\x07");
  assert.equal(ends.length, 0);
  w.input("oi\r");
  w.output("\x1b]7501;state=working:app=codex\x1b\\");
  c.advance(4000);
  w.output("\x1b]7501;state=idle:app=codex\x1b\\");
  assert.equal(ends.length, 1);
});

test("Codex: Enter numa tela de abertura (confiança, revisão de hooks) não vira fim de resposta", () => {
  const c = clock();
  const ends = [];
  const w = createTurnWatcher({ providerId: "codex", onTurnEnd: (e) => ends.push(e), ...c });
  // Codex CLI 0.166.0 com hooks alterados: nenhum estado até a pessoa passar da tela de revisão.
  w.input("\r");
  w.output("\x1b]7501;state=idle:app=codex\x07");
  w.output("\x1b]7501;state=working:app=codex\x07");
  c.advance(2500);
  w.output("\x1b]7501;state=idle:app=codex\x07");
  assert.equal(ends.length, 0, "a inicialização depois da tela não é resposta");
  w.input("oi\r");
  w.output("\x1b]7501;state=working:app=codex\x07");
  c.advance(3000);
  w.output("\x1b]7501;state=idle:app=codex\x07");
  assert.equal(ends.length, 1);
});

test("AGY: silêncio depois de uma resposta encerra; atividade curta (eco, comando de barra) não", () => {
  const c = clock();
  const ends = [];
  const w = createTurnWatcher({ providerId: "antigravity", onTurnEnd: (e) => ends.push(e), ...c });
  w.output("tela inicial");
  c.advance(10000);
  assert.equal(ends.length, 0, "sem Enter, nada conta");
  w.input("/help\r");
  w.output("ajuda");
  c.advance(3500);
  assert.equal(ends.length, 0, "atividade curta não é resposta");
  w.input("rode os testes\r");
  for (let i = 0; i < 20; i++) {
    w.output("⠋ trabalhando");
    c.advance(500);
  }
  assert.equal(ends.length, 0, "enquanto a tela anima, ainda trabalha");
  c.advance(3000);
  assert.equal(ends.length, 1);
  c.advance(10000);
  assert.equal(ends.length, 1);
  w.dispose();
});
