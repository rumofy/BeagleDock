const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const ts = require("typescript");
function load(file) {
  const out = ts.transpileModule(fs.readFileSync(path.resolve(file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context = { exports: {}, setTimeout, clearTimeout, performance };
  vm.runInNewContext(out, context);
  return context.exports;
}
const { createFrameBatcher, createFrameScheduler } = load("src/lib/frameBatcher.ts");
const { applyStreamItems } = load("src/lib/streamApply.ts");
const { percentile, recordStreamSample, getStreamStats, resetStreamStats } = load("src/lib/streamMetrics.ts");
const { formatDuration } = load("src/lib/duration.ts");
// Objetos criados no vm têm outro protótipo; comparar o conteúdo, não a referência.
const plain = (value) => JSON.parse(JSON.stringify(value));

const msg = (extra = {}) => ({
  id: "r1",
  sessionId: "s1",
  sender: "claude",
  senderName: "Claude",
  text: "",
  timestamp: "",
  isStreaming: true,
  startedAt: 1000,
  ...extra,
});
const chunk = (payload, receivedAt = 0) => ({ kind: "chunk", payload: { sessionId: "s1", responseMessageId: "r1", ...payload }, receivedAt });
const event = (e, receivedAt = 0) => ({ kind: "event", payload: { sessionId: "s1", responseMessageId: "r1", event: e }, receivedAt });

test("agrupador entrega tudo, em ordem, em um único flush por quadro", () => {
  const flushes = [];
  let run;
  const batcher = createFrameBatcher((items) => flushes.push(items), (cb) => (run = cb));
  batcher.push(1);
  batcher.push(2);
  batcher.push(3);
  assert.equal(flushes.length, 0);
  assert.equal(batcher.pending(), 3);
  run();
  assert.deepEqual(plain(flushes), [[1, 2, 3]]);
  batcher.push(4);
  run();
  assert.deepEqual(plain(flushes), [[1, 2, 3], [4]]);
});

test("lote de pedaços vira uma só atualização e preserva as outras mensagens", () => {
  const other = msg({ id: "r0", isStreaming: false, text: "antiga" });
  const prev = { s1: [other, msg()], s2: [msg({ id: "x", sessionId: "s2" })] };
  const next = applyStreamItems(prev, [chunk({ fullText: "Olá" }), chunk({ fullText: "Olá mundo" })], 5000);
  assert.equal(next.s1[1].text, "Olá mundo");
  assert.equal(next.s1[0], other, "mensagem antiga mantém a identidade (memo não re-renderiza)");
  assert.equal(next.s2, prev.s2);
  assert.notEqual(next.s1, prev.s1);
  assert.equal(prev.s1[1].text, "", "estado anterior não é mutado");
});

test("progresso real atualiza lastProgressAt; sinal de vida repetido só atualiza lastEventAt", () => {
  let state = applyStreamItems({ s1: [msg()] }, [chunk({ activity: "Raciocinando…" })], 2000);
  assert.equal(state.s1[0].lastProgressAt, 2000);
  assert.equal(state.s1[0].activitySince, 2000);
  state = applyStreamItems(state, [chunk({ activity: "Raciocinando…" })], 9000);
  assert.equal(state.s1[0].lastEventAt, 9000);
  assert.equal(state.s1[0].lastProgressAt, 2000, "mesma atividade repetida não é progresso");
  assert.equal(state.s1[0].activitySince, 2000);
  state = applyStreamItems(state, [chunk({ activity: "Executando comando…", detail: "npm test" })], 12000);
  assert.equal(state.s1[0].lastProgressAt, 12000);
  assert.equal(state.s1[0].detail, "npm test");
  state = applyStreamItems(state, [chunk({ fullText: "texto novo" })], 15000);
  assert.equal(state.s1[0].lastProgressAt, 15000);
});

test("eventos da linha do tempo entram em ordem e são atualizados pelo id", () => {
  const e = (extra) => ({ id: "t1", kind: "command", title: "Bash", status: "running", ...extra });
  let state = applyStreamItems({ s1: [msg()] }, [event(e()), event(e({ id: "t2", kind: "reasoning", title: "R" }))], 3000);
  assert.deepEqual(plain(state.s1[0].events.map((x) => x.id)), ["t1", "t2"]);
  state = applyStreamItems(state, [event(e({ status: "done", durationMs: 40 }))], 4000);
  assert.equal(state.s1[0].events.length, 2);
  assert.equal(state.s1[0].events[0].status, "done");
  assert.equal(state.s1[0].lastProgressAt, 4000);
  state = applyStreamItems(state, [event(e({ status: "done", durationMs: 40 }))], 8000);
  assert.equal(state.s1[0].lastProgressAt, 4000, "evento idêntico é só sinal de vida");
  assert.equal(state.s1[0].lastEventAt, 8000);
});

test("eventos de mensagens já concluídas ou de outra resposta são ignorados", () => {
  const done = { s1: [msg({ isStreaming: false })] };
  assert.equal(applyStreamItems(done, [chunk({ fullText: "x" })], 1), done);
  const other = { s1: [msg()] };
  assert.equal(applyStreamItems(other, [chunk({ responseMessageId: "outra", fullText: "x" })], 1), other);
});

test("ANSI é removido do texto recebido", () => {
  const next = applyStreamItems({ s1: [msg()] }, [chunk({ fullText: "\x1b[31mvermelho\x1b[0m" })], 1);
  assert.equal(next.s1[0].text, "vermelho");
});

test("métricas: percentis e soma das etapas do atraso", () => {
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([10, 20, 30, 40, 50], 50), 30);
  assert.equal(percentile([1, 2, 3, 4, 100], 95), 100);
  resetStreamStats();
  for (let i = 1; i <= 20; i++) recordStreamSample({ ipcMs: i, frameWaitMs: 5, commitMs: 2 });
  const stats = getStreamStats();
  assert.equal(stats.count, 20);
  assert.equal(stats.p50, 17);
  assert.equal(stats.max, 27);
  recordStreamSample({ ipcMs: -5, frameWaitMs: 0, commitMs: 0 });
  assert.equal(getStreamStats().count, 20, "amostra inválida é descartada");
});

test("duração legível", () => {
  assert.equal(formatDuration(850), "850 ms");
  assert.equal(formatDuration(4200), "4,2 s");
  assert.equal(formatDuration(125000), "2:05");
  assert.equal(formatDuration(-1), "");
});

test("agendador usa o quadro de animação e cancela o prazo de segurança", () => {
  const calls = [];
  let frame, timer, cleared = null;
  const schedule = createFrameScheduler({
    raf: (cb) => (frame = cb),
    setTimer: (cb, ms) => ((timer = cb), (calls.push(ms), "t1")),
    clearTimer: (id) => (cleared = id),
  });
  let runs = 0;
  schedule(() => runs++);
  assert.deepEqual(plain(calls), [50]);
  frame();
  timer();
  assert.equal(runs, 1, "executa uma única vez");
  assert.equal(cleared, "t1");
});

test("com a janela oculta o quadro não vem e o prazo de segurança entrega o lote", () => {
  let timer;
  const schedule = createFrameScheduler({
    raf: () => undefined,
    setTimer: (cb) => (timer = cb),
    clearTimer: () => {},
  });
  const flushed = [];
  const batcher = createFrameBatcher((items) => flushed.push(...items), schedule);
  batcher.push("a");
  batcher.push("b");
  assert.equal(flushed.length, 0);
  timer();
  assert.deepEqual(plain(flushed), ["a", "b"]);
});

test("evento sem id de resposta só vale com uma única mensagem em streaming", () => {
  const first = msg({ id: "a", text: "" });
  const second = msg({ id: "b", text: "" });
  const queued = { s1: [first, second] };
  assert.equal(applyStreamItems(queued, [chunk({ responseMessageId: undefined, activity: "Na fila" })], 1), queued, "ambíguo: ignora");
  const single = { s1: [msg({ id: "a" })] };
  const next = applyStreamItems(single, [chunk({ responseMessageId: undefined, fullText: "ok" })], 1);
  assert.equal(next.s1[0].text, "ok");
});

test("lote pendente na hora em que o turno termina não reabre nem altera a resposta final", () => {
  const finished = { s1: [msg({ isStreaming: false, text: "texto final", events: [{ id: "e", kind: "command", title: "B", status: "done" }] })] };
  const next = applyStreamItems(
    finished,
    [chunk({ fullText: "parcial atrasado" }), event({ id: "e", kind: "command", title: "B", status: "running" })],
    9,
  );
  assert.equal(next, finished);
  assert.equal(next.s1[0].text, "texto final");
  assert.equal(next.s1[0].events[0].status, "done");
});

test("vários pedaços do mesmo texto num quadro: vale o último, e todos contam como progresso", () => {
  const prev = { s1: [msg({ lastProgressAt: 100 })] };
  const next = applyStreamItems(prev, [
    chunk({ fullText: "Ol" }, 0), chunk({ fullText: "Olá" }, 0), chunk({ fullText: "Olá \x1b[31mmundo\x1b[0m", activity: "IA respondendo…" }, 0),
  ], 5000);
  assert.equal(next.s1[0].text, "Olá mundo");
  assert.equal(next.s1[0].lastProgressAt, 5000);
  assert.equal(next.s1[0].activity, "IA respondendo…");
  // mensagens diferentes no mesmo quadro não interferem entre si
  const two = { s1: [msg({ id: "a" }), msg({ id: "b" })] };
  const both = applyStreamItems(two, [
    chunk({ responseMessageId: "a", fullText: "A1" }), chunk({ responseMessageId: "b", fullText: "B1" }), chunk({ responseMessageId: "a", fullText: "A2" }),
  ], 1);
  assert.equal(both.s1[0].text, "A2");
  assert.equal(both.s1[1].text, "B1");
});

test("resposta concluída ainda recebe atualizações de agentes que ela já tem (e das etapas filhas), nada além", () => {
  const finished = { s1: [msg({ isStreaming: false, text: "final", events: [{ id: "ag", kind: "agent", title: "A", status: "running", meta: { background: true } }] })] };
  const upd = applyStreamItems(finished, [event({ id: "ag", kind: "agent", title: "A", status: "done", text: "ok" })], 5);
  assert.equal(upd.s1[0].events[0].status, "done");
  assert.equal(upd.s1[0].text, "final", "o texto da resposta não muda");
  const child = applyStreamItems(upd, [event({ id: "filho", parentId: "ag", kind: "command", title: "B", status: "running" })], 6);
  assert.deepEqual(plain(child.s1[0].events.map((e) => e.id)), ["ag", "filho"]);
  // etapa sem relação com a resposta, ou texto tardio, continua ignorada
  const stray = applyStreamItems(child, [event({ id: "estranho", kind: "tool", title: "X", status: "running" }), chunk({ fullText: "texto atrasado" })], 7);
  assert.equal(stray, child);
});
