const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSessionService } = require("../electron/session-service");

function setup({ inject = () => false } = {}) {
  const saved = [], deleted = [], kills = [];
  const gates = [];
  const started = [];
  const runner = {
    inject,
    kill: (id) => {
      kills.push(id);
      gates.shift()?.({ ok: false, cancelled: true, output: "parcial" });
    },
    execute: (payload) => {
      started.push(payload.responseMessageId);
      return new Promise((resolve) => gates.push(resolve));
    },
  };
  const store = {
    sessionExists: async () => true,
    saveChatMessage: async (m) => saved.push(m),
    deleteChatMessage: async (s, id) => deleted.push(id),
    setSessionContext: async () => {},
    deleteSessionFromDb: async () => {},
  };
  return { service: createSessionService({ store, runner }), saved, deleted, kills, gates, started };
}
const p = (n, extra = {}) => ({ sessionId: "s1", providerId: "claude", responseMessageId: `r${n}`, prompt: `m${n}` , ...extra });
const tick = () => new Promise((r) => setImmediate(r));

test("mensagem da fila removida antes de a CLI recebê-la nunca chega à CLI e é apagada do histórico", async () => {
  const t = setup();
  const first = t.service.execute(p(1));
  await tick();
  const second = t.service.execute(p(2));
  await tick();
  const third = t.service.execute(p(3));
  const removed = await t.service.cancelQueued({ sessionId: "s1", responseMessageId: "r2", userMessageId: "u2" });
  assert.equal(removed.ok, true);
  assert.deepEqual(t.deleted.sort(), ["r2", "u2"]);
  t.gates.shift()({ ok: true, output: "um" });
  assert.equal((await first).ok, true);
  assert.equal((await second).discarded, true);
  await tick(); await tick();
  assert.deepEqual(t.started, ["r1", "r3"], "a mensagem removida foi pulada");
  t.gates.shift()({ ok: true, output: "três" });
  assert.equal((await third).output, "três");
});

test("não remove da fila uma mensagem que a CLI já recebeu", async () => {
  const t = setup();
  const first = t.service.execute(p(1));
  await tick(); await tick();
  const res = await t.service.cancelQueued({ sessionId: "s1", responseMessageId: "r1", userMessageId: "u1" });
  assert.equal(res.ok, false);
  assert.deepEqual(t.deleted, []);
  t.gates.shift()({ ok: true, output: "x" });
  await first;
});

test("enviar agora interrompe só a execução atual e a mensagem da fila é a próxima", async () => {
  const t = setup();
  const first = t.service.execute(p(1));
  await tick();
  const second = t.service.execute(p(2));
  await tick(); await tick();
  const res = await t.service.forceQueued({ sessionId: "s1", responseMessageId: "r2", userMessageId: "u2" });
  assert.equal(res.ok, true);
  assert.deepEqual(t.kills, ["s1"]);
  const stopped = await first;
  assert.equal(stopped.cancelled, true);
  await tick(); await tick();
  assert.deepEqual(t.started, ["r1", "r2"], "a segunda não foi cancelada junto");
  t.gates.shift()({ ok: true, output: "dois" });
  assert.equal((await second).output, "dois");
});

test("durante uma execução do Claude, a mensagem é entregue ao turno atual em vez de esperar o fim", async () => {
  const injected = [];
  const t = setup({ inject: (payload) => (injected.push(payload.prompt), true) });
  const first = t.service.execute(p(1));
  await tick();
  const second = await t.service.execute(p(2));
  assert.equal(second.injected, true);
  assert.deepEqual(injected, ["m2"]);
  assert.deepEqual(t.started, ["r1"]);
  t.gates.shift()({ ok: true, output: "tudo" });
  await first;
});

test("com mensagem já esperando na fila, a seguinte não fura a ordem entrando no turno atual", async () => {
  let allow = false;
  const injected = [];
  const t = setup({ inject: (payload) => allow && (injected.push(payload.prompt), true) });
  const first = t.service.execute(p(1));
  await tick();
  const second = t.service.execute(p(2)); // CLI não aceitou: espera na fila
  await tick();
  allow = true;
  const third = t.service.execute(p(3)); // há uma na frente: também espera
  await tick();
  assert.deepEqual(injected, []);
  t.gates.shift()({ ok: true, output: "um" });
  await first;
  await tick(); await tick();
  t.gates.shift()({ ok: true, output: "dois" });
  await second;
  await tick(); await tick();
  t.gates.shift()({ ok: true, output: "três" });
  assert.equal((await third).output, "três");
  assert.deepEqual(t.started, ["r1", "r2", "r3"]);
});

test("enviar agora só vale para a próxima da fila; mensagem já concluída não pode ser removida nem forçada", async () => {
  const t = setup();
  const first = t.service.execute(p(1));
  await tick();
  const second = t.service.execute(p(2));
  await tick();
  const third = t.service.execute(p(3));
  await tick();
  const forceThird = await t.service.forceQueued({ sessionId: "s1", responseMessageId: "r3", userMessageId: "u3" });
  assert.equal(forceThird.ok, false, "r2 está na frente de r3");
  assert.deepEqual(t.kills, []);
  t.gates.shift()({ ok: true, output: "um" });
  await first;
  await tick(); await tick();
  t.gates.shift()({ ok: true, output: "dois" });
  await second;
  await tick(); await tick();
  const staleRemove = await t.service.cancelQueued({ sessionId: "s1", responseMessageId: "r2", userMessageId: "u2" });
  const staleForce = await t.service.forceQueued({ sessionId: "s1", responseMessageId: "r2", userMessageId: "u2" });
  assert.equal(staleRemove.ok, false);
  assert.equal(staleForce.ok, false);
  assert.deepEqual(t.deleted, [], "o histórico de r2 não foi apagado");
  assert.deepEqual(t.kills, [], "o turno de r3 não foi derrubado");
  t.gates.shift()({ ok: true, output: "três" });
  await third;
});

test("mensagem removida da fila não é recriada por um salvamento que chega depois", async () => {
  const t = setup();
  const first = t.service.execute(p(1));
  await tick();
  const second = t.service.execute(p(2));
  await tick();
  await t.service.cancelQueued({ sessionId: "s1", responseMessageId: "r2", userMessageId: "u2" });
  await t.service.saveChatMessage({ id: "u2", sessionId: "s1", sender: "user", text: "m2" });
  assert.equal(t.saved.some((m) => m.id === "u2"), false);
  t.gates.shift()({ ok: true, output: "um" });
  await first;
  await second;
});

test("mensagem em decisão de injeção não pode ser removida", async () => {
  let release;
  const t = setup({ inject: () => new Promise((r) => (release = r)) });
  const first = t.service.execute(p(1));
  await tick();
  const second = t.service.execute(p(2));
  await tick();
  const res = await t.service.cancelQueued({ sessionId: "s1", responseMessageId: "r2", userMessageId: "u2" });
  assert.equal(res.ok, false);
  release(true);
  assert.equal((await second).injected, true);
  t.gates.shift()({ ok: true });
  await first;
});
