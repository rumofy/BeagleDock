const test = require("node:test");
const assert = require("node:assert/strict");
const { createCliTerminals, terminalArgs, terminalEnv } = require("../electron/cli-terminal");

test("terminalArgs retoma a conversa nativa com o argumento de cada CLI", () => {
  assert.deepEqual(terminalArgs("claude", "abc12345-uuid"), ["--resume", "abc12345-uuid"]);
  assert.deepEqual(terminalArgs("codex", "019a-thread-id"), ["resume", "019a-thread-id"]);
  assert.deepEqual(terminalArgs("antigravity", "conv_12345678"), ["--conversation", "conv_12345678"]);
  for (const id of ["claude", "codex", "antigravity"]) assert.deepEqual(terminalArgs(id, undefined), []);
  assert.throws(() => terminalArgs("claude", "--dangerously-skip-permissions"), /ID nativo inválido/);
  assert.throws(() => terminalArgs("outra", "abc12345"), /CLI desconhecida/);
});

test("terminalEnv liga as cores que o chat desliga", () => {
  const env = terminalEnv({
    PATH: "/bin",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    CLAUDECODE: "1",
    CLAUDE_CODE_CHILD_SESSION: "1",
    CLAUDE_CODE_SESSION_ID: "pai",
  });
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.CLAUDE_CODE_CHILD_SESSION, undefined);
  assert.equal(env.CLAUDE_CODE_SESSION_ID, undefined);
  assert.equal(env.TERM, "xterm-256color");
  assert.equal(env.COLORTERM, "truecolor");
  assert.equal(env.FORCE_COLOR, undefined);
  assert.equal(env.NO_COLOR, undefined);
  assert.equal(env.PATH, "/bin");
});

function fakePty() {
  const spawned = [];
  return {
    spawned,
    spawn(bin, args, options) {
      const proc = {
        bin,
        args,
        options,
        pid: 4242 + spawned.length,
        written: [],
        sizes: [],
        killed: false,
        write(data) {
          this.written.push(data);
        },
        resize(cols, rows) {
          this.sizes.push([cols, rows]);
        },
        kill() {
          this.killed = true;
        },
        onData(cb) {
          this.emitData = cb;
        },
        onExit(cb) {
          this.emitExit = cb;
        },
      };
      spawned.push(proc);
      return proc;
    },
  };
}

function setup({ link = null, beforeOpen } = {}) {
  const pty = fakePty();
  const events = [];
  const opened = [];
  const terminals = createCliTerminals({
    pty,
    find: (name) => (name === "antigravity" ? null : `/bin/${name}`),
    env: () => ({ PATH: "/bin", FORCE_COLOR: "0" }),
    checkCwd: (cwd) => {
      if (cwd !== "/proj") throw new Error("Selecione um diretório de trabalho existente.");
      return cwd;
    },
    store: { getNativeSession: async () => link },
    beforeOpen: beforeOpen || (async (id) => opened.push(id)),
    emit: (channel, payload) => events.push([channel, payload]),
  });
  return { pty, events, opened, terminals };
}

test("abre a CLI no pty retomando a conversa e encerra o processo do chat antes", async () => {
  const { pty, opened, terminals } = setup({ link: { nativeId: "conv_12345678", cwd: "/proj" } });
  const result = await terminals.open({ sessionId: "s1", providerId: "antigravity", cwd: "/proj", cols: 120, rows: 40 });
  assert.equal(result.ok, true);
  assert.equal(result.resumed, true);
  assert.deepEqual(opened, ["s1"]);
  const proc = pty.spawned[0];
  assert.equal(proc.bin, "/bin/agy");
  assert.deepEqual(proc.args, ["--conversation", "conv_12345678"]);
  assert.equal(proc.options.cwd, "/proj");
  assert.equal(proc.options.cols, 120);
  assert.equal(proc.options.env.FORCE_COLOR, undefined);
  assert.equal(terminals.isOpen("s1"), true);
});

test("conversa sem id nativo abre uma conversa nova da CLI", async () => {
  const { pty, terminals } = setup();
  const result = await terminals.open({ sessionId: "s1", providerId: "codex", cwd: "/proj" });
  assert.equal(result.resumed, false);
  assert.deepEqual(pty.spawned[0].args, []);
  assert.equal(pty.spawned[0].bin, "/bin/codex");
});

test("reabrir uma visão reaproveita o processo e devolve a tela já emitida", async () => {
  const { pty, events, terminals } = setup();
  await terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  pty.spawned[0].emitData("olá ");
  pty.spawned[0].emitData("mundo");
  assert.deepEqual(events.at(-1), ["cli-terminal-data", { sessionId: "s1", data: "mundo", end: 9 }]);
  const again = await terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  assert.equal(pty.spawned.length, 1);
  assert.equal(again.replay, "olá mundo");
  assert.equal(again.end, 9);
});

test("repassa teclas e tamanho, e fecha matando o processo", async () => {
  const { pty, terminals } = setup();
  await terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  assert.deepEqual(terminals.write({ sessionId: "s1", data: "\x16" }), { ok: true });
  terminals.resize({ sessionId: "s1", cols: 80, rows: 24 });
  assert.deepEqual(pty.spawned[0].written, ["\x16"]);
  assert.deepEqual(pty.spawned[0].sizes, [[80, 24]]);
  terminals.close("s1");
  assert.equal(pty.spawned[0].killed, true);
  assert.equal(terminals.isOpen("s1"), false);
  assert.deepEqual(terminals.write({ sessionId: "s1", data: "x" }), { ok: false });
});

test("CLI que encerrou: avisa a tela e a próxima abertura cria outro processo", async () => {
  const { pty, events, terminals } = setup();
  await terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  pty.spawned[0].emitExit({ exitCode: 0 });
  assert.deepEqual(events.at(-1), ["cli-terminal-exit", { sessionId: "s1", exitCode: 0 }]);
  assert.equal(terminals.isOpen("s1"), false);
  assert.equal(terminals.list()[0].exited, true);
  await terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  assert.equal(pty.spawned.length, 2);
});

test("recusa abrir com turno rodando no chat, diretório diferente ou CLI ausente", async () => {
  const busy = setup({
    beforeOpen: async () => {
      throw new Error("Espere a resposta atual terminar antes de abrir o terminal.");
    },
  });
  const r1 = await busy.terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  assert.deepEqual(r1, { ok: false, error: "Espere a resposta atual terminar antes de abrir o terminal." });
  assert.equal(busy.pty.spawned.length, 0);

  const moved = setup({ link: { nativeId: "abc12345", cwd: "/outro" } });
  const r2 = await moved.terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /outro diretório/);

  const missing = createCliTerminals({
    pty: fakePty(),
    find: () => null,
    checkCwd: (c) => c,
    store: { getNativeSession: async () => null },
  });
  const r3 = await missing.open({ sessionId: "s1", providerId: "codex", cwd: "/proj" });
  assert.match(r3.error, /não encontrada/);

  const noPty = createCliTerminals({ pty: null, find: () => "/bin/x", checkCwd: (c) => c, store: {} });
  assert.match((await noPty.open({ sessionId: "s1", providerId: "codex", cwd: "/proj" })).error, /node-pty/);
});

test("closeAll encerra todos os terminais", async () => {
  const { pty, terminals } = setup();
  await terminals.open({ sessionId: "a", providerId: "claude", cwd: "/proj" });
  await terminals.open({ sessionId: "b", providerId: "codex", cwd: "/proj" });
  terminals.closeAll();
  assert.deepEqual(
    pty.spawned.map((p) => p.killed),
    [true, true],
  );
  assert.deepEqual(terminals.list(), []);
});

test("duas aberturas ao mesmo tempo compartilham um único processo", async () => {
  const { pty, terminals } = setup();
  const [a, b] = await Promise.all([
    terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" }),
    terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" }),
  ]);
  assert.equal(pty.spawned.length, 1);
  assert.equal(a.pid, b.pid);
});

test("processo antigo não escreve na tela depois de fechado", async () => {
  const { pty, events, terminals } = setup();
  await terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  terminals.close("s1");
  await terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  const before = events.length;
  pty.spawned[0].emitData("velho");
  pty.spawned[0].emitExit({ exitCode: 1 });
  assert.equal(events.length, before);
  pty.spawned[1].emitData("novo");
  assert.deepEqual(events.at(-1), ["cli-terminal-data", { sessionId: "s1", data: "novo", end: 4 }]);
});

test("Ctrl+V: lê a área de transferência assíncrona do Electron (imagem e texto)", async () => {
  const { readTerminalClipboard } = require("../electron/cli-terminal");
  const clip = (types, text) => ({
    has: async (type) => types.includes(type),
    readText: async () => text,
  });
  assert.deepEqual(await readTerminalClipboard(clip(["image/png"], "")), { image: true, text: "" });
  assert.deepEqual(await readTerminalClipboard(clip(["image/jpeg"], "")), { image: true, text: "" });
  assert.deepEqual(await readTerminalClipboard(clip([], "olá")), { image: false, text: "olá" });
  // Falha ao ler não derruba o Ctrl+V.
  const broken = { has: async () => { throw new Error("x"); }, readText: () => { throw new Error("y"); } };
  assert.deepEqual(await readTerminalClipboard(broken), { image: false, text: "" });
});
