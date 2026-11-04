// Modo terminal: descobre, pela tela da própria CLI, quando uma resposta termina (ou a CLI para
// esperando você, numa aprovação). O BeagleDock não conversa com a CLI nesse modo; ele só vê os
// bytes do terminal. Sinais verificados com as CLIs reais (Claude Code 2.1.317, Codex CLI 0.166.0,
// AGY 1.4.12):
// - Claude Code: o título da janela (OSC 0) mostra um spinner (◐ ◓ ◑ ◒) enquanto trabalha e volta a
//   "✳" quando termina ou para num pedido de permissão. Responde sozinho também (agente em segundo
//   plano), então o spinner basta para começar a contar.
// - Codex CLI: avisa o estado em OSC 7501 (`state=working` / `state=idle`). Na abertura ele também
//   passa por `working`, por isso só conta depois de você enviar algo (Enter).
// - AGY: não manda sinal nenhum; enquanto trabalha a tela anima sem parar, e ao terminar fica em
//   silêncio. Conta como fim o silêncio depois de um período de atividade, também só depois do Enter.

const CLAUDE_BUSY = /^[◐◓◑◒⠀-⣿]/u;
const CLAUDE_IDLE = /^✳/u;
// Títulos e estados podem chegar cortados entre dois pedaços de saída: guarda o fim do anterior.
const CARRY = 256;

function lastMatch(text, pattern) {
  let found = null;
  for (const m of text.matchAll(pattern)) found = m;
  return found;
}

function createTurnWatcher({
  providerId,
  onTurnEnd,
  now = Date.now,
  setTimer = (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimer = clearTimeout,
  // AGY: silêncio que encerra a resposta e atividade mínima para contar como resposta (um comando
  // de barra ou um Enter vazio redesenham pouco e não devem virar notificação).
  quietMs = 3000,
  minActiveMs = 2500,
  // Trabalho curto demais (ex.: o redesenho de um Enter vazio) não é resposta.
  minBusyMs = 800,
}) {
  let armed = false;
  let busySince = null;
  let firstOutput = null;
  let quietTimer = null;
  let tail = "";

  function end() {
    const startedAt = busySince ?? firstOutput;
    armed = false;
    busySince = null;
    firstOutput = null;
    if (quietTimer) clearTimer(quietTimer);
    quietTimer = null;
    onTurnEnd?.({ providerId, startedAt, endedAt: now() });
  }

  function busy() {
    if (busySince === null) busySince = now();
  }
  function idle() {
    if (busySince === null) return;
    if (now() - busySince < minBusyMs) {
      busySince = null;
      return;
    }
    end();
  }

  return {
    // O que a pessoa digitou no terminal: o Enter arma a espera pelo fim da resposta.
    input(data) {
      if (typeof data !== "string" || !data.includes("\r")) return;
      armed = true;
      firstOutput = null;
      if (providerId !== "claude") busySince = null;
    },
    output(data) {
      if (typeof data !== "string" || !data) return;
      const text = tail + data;
      tail = text.slice(-CARRY);
      if (providerId === "claude") {
        const title = lastMatch(text, /\x1b\]0;([^\x07\x1b]*)(?:\x07|\x1b\\)/g);
        if (!title) return;
        // Evita contar duas vezes o mesmo título que ficou no pedaço guardado.
        tail = text.slice(title.index + title[0].length).slice(-CARRY);
        if (CLAUDE_BUSY.test(title[1])) busy();
        else if (CLAUDE_IDLE.test(title[1])) idle();
        return;
      }
      if (providerId === "codex") {
        const state = lastMatch(text, /\x1b\]7501;([^\x07\x1b]*)(?:\x07|\x1b\\)/g);
        if (!state) return;
        tail = text.slice(state.index + state[0].length).slice(-CARRY);
        if (!armed) return;
        if (/(^|:)state=working\b/.test(state[1])) busy();
        else if (/(^|:)state=idle\b/.test(state[1])) idle();
        return;
      }
      // AGY: só a atividade da tela.
      if (!armed) return;
      if (firstOutput === null) firstOutput = now();
      if (quietTimer) clearTimer(quietTimer);
      quietTimer = setTimer(() => {
        quietTimer = null;
        if (armed && firstOutput !== null && now() - quietMs - firstOutput >= minActiveMs) end();
        else {
          // Atividade curta (eco do Enter, um comando de barra): não era uma resposta.
          armed = false;
          firstOutput = null;
        }
      }, quietMs);
    },
    dispose() {
      if (quietTimer) clearTimer(quietTimer);
      quietTimer = null;
      armed = false;
    },
  };
}

module.exports = { createTurnWatcher };
