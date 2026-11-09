const test = require("node:test");
const assert = require("node:assert/strict");
const { createCliTerminals, terminalArgs, terminalEnv } = require("../electron/cli-terminal");

test("terminalArgs resumes the native conversation with each CLI's argument", () => {
  assert.deepEqual(terminalArgs("claude", "abc12345-uuid"), ["--resume", "abc12345-uuid"]);
  assert.deepEqual(terminalArgs("codex", "019a-thread-id"), ["--no-alt-screen", "resume", "019a-thread-id"]);
  assert.deepEqual(terminalArgs("antigravity", "conv_12345678"), ["--conversation", "conv_12345678"]);
  for (const id of ["claude", "antigravity"]) assert.deepEqual(terminalArgs(id, undefined), []);
  // Codex runs inline so its output stays in the terminal's scrollback.
  assert.deepEqual(terminalArgs("codex", undefined), ["--no-alt-screen"]);
  assert.throws(() => terminalArgs("claude", "--dangerously-skip-permissions"), /Invalid native ID/);
  assert.throws(() => terminalArgs("outra", "abc12345"), /Unknown CLI/);
});

test("terminalEnv turns on the colors the chat turns off", () => {
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

function setup({ link = null, beforeOpen, hooks } = {}) {
  const pty = fakePty();
  const events = [];
  const opened = [];
  const terminals = createCliTerminals({
    pty,
    find: (name) => (name === "antigravity" ? null : `/bin/${name}`),
    env: () => ({ PATH: "/bin", FORCE_COLOR: "0" }),
    checkCwd: (cwd) => {
      if (cwd !== "/proj") throw new Error("Select an existing working directory.");
      return cwd;
    },
    store: { getNativeSession: async () => link, lockSessionCwd: async () => {} },
    beforeOpen: beforeOpen || (async (id) => opened.push(id)),
    emit: (channel, payload) => events.push([channel, payload]),
    hooks,
    newId: () => "11111111-2222-3333-4444-555555555555",
  });
  return { pty, events, opened, terminals };
}

test("opens the CLI in the pty resuming the conversation and stops the chat's process first", async () => {
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

test("a conversation without a native id opens a new CLI conversation", async () => {
  const { pty, terminals } = setup();
  const result = await terminals.open({ sessionId: "s1", providerId: "codex", cwd: "/proj" });
  assert.equal(result.resumed, false);
  assert.deepEqual(pty.spawned[0].args, ["--no-alt-screen"]);
  assert.equal(pty.spawned[0].bin, "/bin/codex");
});

for (const providerId of ["claude", "codex", "antigravity"]) {
  test(`${providerId}: opening and running terminals refuse a different folder or provider`, async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { terminals, pty } = setup({ beforeOpen: () => gate });
    const first = terminals.open({ sessionId: "s1", providerId, cwd: "/proj" });
    const moved = terminals.open({ sessionId: "s1", providerId, cwd: "/other" });
    release();
    assert.equal((await first).ok, true);
    assert.equal((await moved).ok, false);
    assert.equal((await terminals.open({ sessionId: "s1", providerId, cwd: "/other" })).ok, false);
    assert.equal((await terminals.open({ sessionId: "s1", providerId: providerId === "claude" ? "codex" : "claude", cwd: "/proj" })).ok, false);
    assert.equal(pty.spawned.length, 1);
    assert.equal(pty.spawned[0].options.cwd, "/proj");
  });
}

test("a terminal cannot spawn if its saved project changed before the directory claim", async () => {
  const pty = fakePty();
  const terminals = createCliTerminals({
    pty, find: () => "/bin/claude", checkCwd: (cwd) => cwd,
    store: {
      getNativeSession: async () => null,
      lockSessionCwd: async () => { throw new Error("This conversation belongs to another directory."); },
    },
  });
  const result = await terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/stale" });
  assert.equal(result.ok, false);
  assert.equal(pty.spawned.length, 0);
});

test("reopening a view reuses the process and returns the screen already emitted", async () => {
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

test("relays keys and size, and closes by killing the process", async () => {
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

test("a CLI that exited: tells the screen and the next opening creates another process", async () => {
  const { pty, events, terminals } = setup();
  await terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  pty.spawned[0].emitExit({ exitCode: 0 });
  assert.deepEqual(events.at(-1), ["cli-terminal-exit", { sessionId: "s1", exitCode: 0 }]);
  assert.equal(terminals.isOpen("s1"), false);
  assert.equal(terminals.list()[0].exited, true);
  await terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  assert.equal(pty.spawned.length, 2);
});

for (const providerId of ["claude", "codex", "antigravity"]) {
  test(`${providerId}: closing removes the terminal and notifies the renderer despite late process events`, async () => {
    const { pty, events, terminals } = setup({ link: { nativeId: "native_12345678", cwd: "/proj" } });
    await terminals.open({ sessionId: "closed", providerId, cwd: "/proj" });
    await terminals.open({ sessionId: "kept", providerId, cwd: "/proj" });
    terminals.close("closed");
    assert.equal(pty.spawned[0].killed, true);
    assert.deepEqual(events.at(-1), ["cli-terminal-closed", { sessionId: "closed" }]);
    const eventCount = events.length;
    pty.spawned[0].emitData("late output");
    pty.spawned[0].emitExit({ exitCode: 0 });
    assert.equal(events.length, eventCount);
    assert.deepEqual(terminals.list().map((entry) => entry.sessionId), ["kept"]);
    assert.equal(terminals.isOpen("kept"), true);
    const resumed = await terminals.open({ sessionId: "closed", providerId, cwd: "/proj" });
    assert.equal(resumed.resumed, true);
    assert.deepEqual(pty.spawned[2].args, terminalArgs(providerId, "native_12345678"));
  });
}

test("refuses to open with a turn running in the chat, a different directory or a missing CLI", async () => {
  const busy = setup({
    beforeOpen: async () => {
      throw new Error("Wait for the current reply to finish before opening the terminal.");
    },
  });
  const r1 = await busy.terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  assert.deepEqual(r1, { ok: false, error: "Wait for the current reply to finish before opening the terminal.", cwdLocked: true });
  assert.equal(busy.pty.spawned.length, 0);

  const moved = setup({ link: { nativeId: "abc12345", cwd: "/outro" } });
  const r2 = await moved.terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /another directory/);

  const missing = createCliTerminals({
    pty: fakePty(),
    find: () => null,
    checkCwd: (c) => c,
    store: { getNativeSession: async () => null, lockSessionCwd: async () => {} },
  });
  const r3 = await missing.open({ sessionId: "s1", providerId: "codex", cwd: "/proj" });
  assert.match(r3.error, /not found/);

  const noPty = createCliTerminals({ pty: null, find: () => "/bin/x", checkCwd: (c) => c, store: {} });
  assert.match((await noPty.open({ sessionId: "s1", providerId: "codex", cwd: "/proj" })).error, /node-pty/);
});

for (const providerId of ["claude", "codex", "antigravity"]) {
  test(`${providerId}: a pre-claim failure leaves the project editable and permits retry`, async () => {
    const { pty, terminals } = setup();
    const failed = await terminals.open({ sessionId: "s1", providerId, cwd: "/missing" });
    assert.equal(failed.ok, false);
    assert.equal(failed.cwdLocked, false);
    assert.equal(pty.spawned.length, 0);
    assert.equal((await terminals.open({ sessionId: "s1", providerId, cwd: "/proj" })).ok, true);
  });
}

test("a spawn failure after claiming the project retains its folder lock", async () => {
  const pty = fakePty();
  pty.spawn = () => { throw new Error("Spawn failed"); };
  const terminals = createCliTerminals({
    pty, find: () => "/bin/claude", checkCwd: (cwd) => cwd,
    store: { getNativeSession: async () => null, lockSessionCwd: async () => {} },
  });
  const failed = await terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  assert.equal(failed.ok, false);
  assert.equal(failed.cwdLocked, true);
});

test("closeAll stops every terminal", async () => {
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

test("two openings at the same time share a single process", async () => {
  const { pty, terminals } = setup();
  const [a, b] = await Promise.all([
    terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" }),
    terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" }),
  ]);
  assert.equal(pty.spawned.length, 1);
  assert.equal(a.pid, b.pid);
});

test("an old process doesn't write to the screen after it's closed", async () => {
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

test("Ctrl+V: reads Electron's async clipboard (image and text)", async () => {
  const { readTerminalClipboard } = require("../electron/cli-terminal");
  const clip = (types, text) => ({
    has: async (type) => types.includes(type),
    readText: async () => text,
  });
  assert.deepEqual(await readTerminalClipboard(clip(["image/png"], "")), { image: true, text: "" });
  assert.deepEqual(await readTerminalClipboard(clip(["image/jpeg"], "")), { image: true, text: "" });
  assert.deepEqual(await readTerminalClipboard(clip([], "olá")), { image: false, text: "olá" });
  // A failure reading doesn't break Ctrl+V.
  const broken = { has: async () => { throw new Error("x"); }, readText: () => { throw new Error("y"); } };
  assert.deepEqual(await readTerminalClipboard(broken), { image: false, text: "" });
});

test("a new Claude Code conversation opens with a known ID, so the history finds it later", async () => {
  assert.deepEqual(terminalArgs("claude", undefined, "abc12345-uuid"), ["--session-id", "abc12345-uuid"]);
  assert.deepEqual(terminalArgs("codex", undefined, "abc12345-uuid"), ["--no-alt-screen"], "only Claude Code accepts choosing the ID");
  assert.throws(() => terminalArgs("claude", undefined, "--x"), /Invalid native ID/);
  const calls = [];
  const hooks = Object.fromEntries(
    ["opened", "input", "output", "exited", "closed"].map((name) => [name, (...args) => calls.push([name, ...args])]),
  );
  const { pty, terminals } = setup({ hooks });
  await terminals.open({ sessionId: "s1", providerId: "claude", cwd: "/proj" });
  const proc = pty.spawned[0];
  assert.deepEqual(proc.args, ["--session-id", "11111111-2222-3333-4444-555555555555"]);
  assert.deepEqual(calls[0], [
    "opened",
    { sessionId: "s1", providerId: "claude", cwd: "/proj", nativeId: undefined, newNativeId: "11111111-2222-3333-4444-555555555555" },
  ]);
  terminals.write({ sessionId: "s1", data: "oi\r" });
  proc.emitData("tela");
  proc.emitExit({ exitCode: 0 });
  terminals.close("s1");
  assert.deepEqual(calls.slice(1).map((c) => c.slice(0, 3)), [
    ["input", "s1", "oi\r"],
    ["output", "s1", "tela"],
    ["exited", "s1"],
    ["closed", "s1"],
  ]);
});

for (const providerId of ["claude", "codex", "antigravity"]) {
  test(`${providerId}: a second view attaches with replay and dimensions without resizing or replacing the CLI`, async () => {
    const { pty, terminals } = setup();
    const request = { sessionId: "s1", providerId, cwd: "/proj", cols: 120, rows: 40 };
    const first = await terminals.open(request);
    pty.spawned[0].emitData("partial output before completion");
    const second = await terminals.open({ ...request, cols: 35, rows: 20 });
    assert.equal(second.pid, first.pid);
    assert.deepEqual([second.cols, second.rows], [120, 40]);
    assert.equal(second.replay, "partial output before completion");
    assert.equal(pty.spawned.length, 1);
    assert.deepEqual(pty.spawned[0].sizes, []);
    terminals.resize({ sessionId: "s1", cols: 100, rows: 32 });
    const reconnected = await terminals.open(request);
    assert.deepEqual([reconnected.cols, reconnected.rows], [100, 32]);
    assert.equal(reconnected.end, second.end);
    assert.equal(reconnected.pid, first.pid);
  });
}
