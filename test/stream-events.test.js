const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createEventTracker } = require("../electron/stream-events");

test("o rastreador publica cada mudança, mede duração e limita o texto", () => {
  let clock = 1000;
  const sent = [];
  const tracker = createEventTracker({ emit: (ch, d) => sent.push([ch, d]), sessionId: "s1", now: () => clock });
  tracker.start("resp");
  tracker.upsert("a", { kind: "command", title: "Bash" });
  clock = 1500;
  tracker.finish("a", "done");
  assert.equal(sent.length, 2);
  assert.equal(sent[0][0], "cli-activity-event");
  assert.equal(sent[0][1].responseMessageId, "resp");
  assert.equal(sent[1][1].event.durationMs, 500);
  assert.equal(sent[1][1].event.status, "done");
  tracker.finish("a", "error");
  assert.equal(sent.length, 2, "evento concluído não muda de novo");
  tracker.upsert("t", { kind: "reasoning", title: "x" });
  tracker.appendText("t", "y".repeat(5000));
  assert.ok(tracker.get("t").text.length <= 4000);
});

test("texto de raciocínio é publicado no máximo a cada 120 ms, mas nunca se perde", () => {
  let clock = 0;
  const sent = [];
  const tracker = createEventTracker({ emit: (_c, d) => sent.push(d.event), sessionId: "s", now: () => clock });
  tracker.start("r");
  tracker.upsert("t", { kind: "reasoning", title: "R" });
  const before = sent.length;
  for (let i = 0; i < 10; i++) {
    clock += 10;
    tracker.appendText("t", "a");
  }
  assert.ok(sent.length - before <= 2);
  tracker.finishRunning();
  assert.equal(sent.at(-1).text, "aaaaaaaaaa");
  assert.equal(sent.at(-1).status, "done");
});

test("start() zera a linha do tempo entre respostas", () => {
  const tracker = createEventTracker({ sessionId: "s" });
  tracker.start("r1");
  tracker.upsert("a", { kind: "tool", title: "T" });
  tracker.start("r2");
  assert.deepEqual(tracker.snapshot(), []);
});

test("agente em segundo plano sobrevive ao fim do turno e ao início do próximo, na resposta de origem", () => {
  const sent = [], late = [];
  const t = createEventTracker({ emit: (_c, d) => sent.push(d), sessionId: "s", onLate: (p) => late.push(p), setTimer: (fn) => fn });
  t.start("r1");
  t.upsert("cmd", { kind: "command", title: "Bash" });
  t.upsert("ag", { kind: "agent", title: "Agente x", meta: { background: true } });
  t.upsert("ag-cmd", { kind: "command", title: "Bash", parentId: "ag" });
  t.finishRunning();
  assert.equal(t.get("cmd").status, "done", "o comando comum é encerrado");
  assert.equal(t.get("ag").status, "running", "o agente em segundo plano não");
  assert.equal(t.get("ag-cmd").status, "running", "nem as etapas dele");
  t.endTurn();
  t.start("r2"); // a pessoa manda outra mensagem
  t.upsert("novo", { kind: "tool", title: "T" });
  assert.deepEqual(t.snapshot().map((e) => e.id), ["novo"], "a resposta nova não herda as etapas antigas");
  // O agente avisa o progresso e termina: vai para a resposta que o lançou (r1), não para r2.
  t.upsert("ag", { meta: { tokens: 500 } });
  t.upsert("ag-cmd2", { kind: "command", title: "Bash", parentId: "ag" });
  t.finish("ag-cmd", "done");
  t.finish("ag", "done", { text: "resultado" });
  const toOld = sent.filter((d) => d.responseMessageId === "r1" && ["ag", "ag-cmd", "ag-cmd2"].includes(d.event.id));
  assert.ok(toOld.length >= 4, "eventos tardios publicados na resposta de origem");
  assert.ok(sent.filter((d) => d.responseMessageId === "r2").every((d) => d.event.id === "novo"));
  t.flushLate();
  const last = late.filter((p) => p.responseMessageId === "r1").at(-1);
  assert.equal(last.events.find((e) => e.id === "ag").status, "done");
  assert.equal(last.events.find((e) => e.id === "ag").text, "resultado");
  assert.equal(last.events.find((e) => e.id === "ag-cmd2").parentId, "ag");
});

test("atualização tardia com o turno já encerrado também avisa para gravar", () => {
  const late = [];
  const t = createEventTracker({ sessionId: "s", onLate: (p) => late.push(p), setTimer: (fn) => fn });
  t.start("r1");
  t.upsert("ag", { kind: "agent", title: "A", meta: { background: true } });
  t.finishRunning();
  t.endTurn();
  t.upsert("ag", { meta: { toolUses: 2 } });
  t.flushLate();
  assert.equal(late.at(-1).responseMessageId, "r1");
  assert.equal(late.at(-1).events[0].meta.toolUses, 2);
});

test("resposta solta sem nada em andamento é esquecida", () => {
  const t = createEventTracker({ sessionId: "s", setTimer: (fn) => fn });
  t.start("r1");
  t.upsert("ag", { kind: "agent", title: "A", meta: { background: true } });
  t.finishRunning();
  t.endTurn();
  t.start("r2");
  t.finish("ag", "done");
  t.flushLate();
  assert.equal(t.get("ag"), undefined);
});

test("mensagem entregue no meio do turno: etapas novas vão para a resposta nova, as antigas terminam na de antes", () => {
  const sent = [], late = [];
  const t = createEventTracker({ emit: (_c, d) => sent.push(d), sessionId: "s", onLate: (p) => late.push(p), setTimer: (fn) => fn });
  t.start("r1");
  t.upsert("cmd", { kind: "command", title: "Bash" });
  t.upsert("bg", { kind: "command", title: "Bash", meta: { background: true } });
  t.rotate("r2");
  t.upsert("think", { kind: "reasoning", title: "Raciocínio" });
  t.finish("cmd", "error");
  assert.equal(sent.find((d) => d.event.id === "think").responseMessageId, "r2");
  assert.equal(sent.filter((d) => d.event.id === "cmd").at(-1).responseMessageId, "r1", "a etapa antiga termina na resposta dela");
  assert.equal(late.length, 0, "durante o turno, a resposta anterior não é atualização tardia");
  t.rotate("r3");
  t.upsert("tool", { kind: "tool", title: "Read" });
  t.finishRunning();
  assert.equal(t.get("think").status, "done", "o que ficou rodando em respostas anteriores também fecha");
  assert.equal(t.get("bg").status, "running", "o comando em segundo plano não");
  assert.deepEqual(t.snapshotFor("r1").map((e) => e.id), ["cmd", "bg"]);
  assert.deepEqual(t.snapshotFor("r2").map((e) => e.id), ["think"]);
  assert.deepEqual(t.snapshotFor("r3").map((e) => e.id), ["tool"]);
  t.endTurn();
  t.finish("bg", "done");
  t.flushLate();
  assert.equal(late.at(-1).responseMessageId, "r1", "depois do turno, o comando em segundo plano atualiza a resposta de origem");
  t.start("r4");
  assert.deepEqual(t.snapshotFor("r2"), [], "o próximo turno esquece as respostas sem nada rodando");
});
