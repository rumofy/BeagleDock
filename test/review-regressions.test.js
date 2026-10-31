const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "beagledock-review-regressions-"),
);
process.env.BEAGLEDOCK_DATA_DIR = root;
const store = require("../electron/database");
const { createSessionService } = require("../electron/session-service");
const { createCliRunner } = require("../electron/cli-runner");
after(async () => {
  await new Promise((resolve, reject) =>
    store.db.close((error) => (error ? reject(error) : resolve())),
  );
  fs.rmSync(root, { recursive: true, force: true });
});
const session = (id) => ({
  id,
  providerId: "claude",
  cwd: root,
  title: "regression",
});
const message = (id, sessionId, text) => ({
  id,
  sessionId,
  sender: "user",
  senderName: "Fixture",
  text,
  timestamp: "2026-01-01T00:00:00Z",
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { resolve, promise };
}
test("reopening existing native history twice replaces saved messages, including after restart", async () => {
  const id = "review-import";
  await store.saveSession(session(id));
  await store.setNativeSession(id, "claude", "native-review-123", root);
  await store.saveChatMessage(message("app-user", id, "hello"));
  await store.saveChatMessage({
    ...message("app-answer", id, "answer"),
    sender: "claude",
  });
  const imported = [
    message("import-user", id, "hello"),
    { ...message("import-answer", id, "answer"), sender: "claude" },
  ];
  for (let i = 0; i < 2; i++) await store.replaceChatMessages(id, imported);
  assert.deepEqual(
    (await store.getChatMessages(id)).map((m) => [m.id, m.text]),
    [
      ["import-user", "hello"],
      ["import-answer", "answer"],
    ],
  );
  const code = `const db=require(${JSON.stringify(path.resolve("electron/database.js"))});(async()=>{console.log(JSON.stringify(await db.getChatMessages('review-import')));await new Promise((r,j)=>db.db.close(e=>e?j(e):r()));})().catch(e=>{console.error(e.message);process.exit(1)});`;
  const restored = JSON.parse(
    execFileSync(process.execPath, ["-e", code], {
      env: { ...process.env, BEAGLEDOCK_DATA_DIR: root },
      encoding: "utf8",
    }),
  );
  assert.deepEqual(
    restored.map((m) => m.id),
    ["import-user", "import-answer"],
  );
});
test("failed replacement rolls back and never overwrites another conversation", async () => {
  const id = "review-rollback",
    other = "review-other";
  await store.saveSession(session(id));
  await store.saveSession(session(other));
  await store.saveChatMessage(message("original", id, "keep"));
  await store.saveChatMessage(message("other-row", other, "private-other"));
  await assert.rejects(
    store.replaceChatMessages(id, [
      message("first-import", id, "temporary"),
      message("other-row", id, "must-not-overwrite"),
    ]),
    /UNIQUE/,
  );
  assert.deepEqual(
    (await store.getChatMessages(id)).map((m) => m.text),
    ["keep"],
  );
  assert.deepEqual(
    (await store.getChatMessages(other)).map((m) => m.text),
    ["private-other"],
  );
});
test("deleting an active turn waits for cancellation, drops response and rejects late writes/native links", async () => {
  const id = "review-delete";
  await store.saveSession(session(id));
  await store.saveChatMessage(message("delete-user", id, "hello"));
  const turn = deferred(),
    started = deferred();
  let killed = false;
  const runner = {
    execute: () => {
      started.resolve();
      return turn.promise;
    },
    kill: () => {
      killed = true;
      turn.resolve({ ok: false, error: "cancelled" });
    },
  };
  const service = createSessionService({ store, runner });
  const pending = service.execute({
    sessionId: id,
    providerId: "claude",
    prompt: "hello",
    responseMessageId: "delete-answer",
  });
  await started.promise;
  const deletion = service.remove(id);
  assert.equal(killed, true);
  assert.equal((await pending).cancelled, true);
  assert.equal((await deletion).success, true);
  assert.equal(await store.sessionExists(id), false);
  assert.deepEqual(await store.getChatMessages(id), []);
  await assert.rejects(
    store.saveChatMessage(message("late-answer", id, "late")),
    /removida/,
  );
  await assert.rejects(
    store.setNativeSession(id, "claude", "native-late-123", root),
    /removida/,
  );
  assert.equal(
    (
      await service.execute({
        sessionId: id,
        providerId: "claude",
        prompt: "late",
      })
    ).cancelled,
    true,
  );
});
test("deletion waits for already queued metadata writes and refuses new ones", async () => {
  const id = "review-queued";
  await store.saveSession(session(id));
  const gate = deferred(),
    started = deferred();
  const delayedStore = {
    ...store,
    saveSession: async (s) => {
      started.resolve();
      await gate.promise;
      return store.saveSession(s);
    },
  };
  const service = createSessionService({
    store: delayedStore,
    runner: { kill() {} },
  });
  const save = service.saveSession({ ...session(id), title: "queued" });
  await started.promise;
  const deletion = service.remove(id);
  await assert.rejects(
    service.saveChatMessage(message("late", id, "late")),
    /removida/,
  );
  gate.resolve();
  await save;
  await deletion;
  assert.equal(await store.sessionExists(id), false);
});
test("runner cancellation during native-id lookup never spawns a process", async () => {
  const lookup = deferred(),
    started = deferred();
  let spawned = false;
  const runner = createCliRunner({
    store: {
      getNativeSession: () => {
        started.resolve();
        return lookup.promise;
      },
    },
    find: () => "/fixture",
    checkCwd: (cwd) => cwd,
    spawn: () => {
      spawned = true;
      throw new Error("must not spawn");
    },
  });
  const pending = runner.execute({
    sessionId: "review-early-cancel",
    providerId: "claude",
    prompt: "hello",
    cwd: root,
  });
  await started.promise;
  runner.kill("review-early-cancel");
  lookup.resolve(null);
  assert.equal((await pending).cancelled, true);
  assert.equal(spawned, false);
  runner.shutdown();
});
test("history replacement refuses a running turn", async () => {
  const id = "review-busy-import";
  await store.saveSession(session(id));
  const turn = deferred(),
    started = deferred();
  const service = createSessionService({
    store,
    runner: {
      execute: () => {
        started.resolve();
        return turn.promise;
      },
      kill() {},
    },
  });
  const pending = service.execute({
    sessionId: id,
    providerId: "claude",
    prompt: "hello",
  });
  await started.promise;
  await assert.rejects(service.replaceChatMessages(id, []), /Aguarde/);
  turn.resolve({ ok: true, output: "done" });
  await pending;
});
test("messages accepted during a turn run automatically in order; deletion cancels the queue", async () => {
  const id = "review-message-queue";
  await store.saveSession(session(id));
  const gates = [deferred(), deferred()],
    start = deferred(),
    calls = [];
  const service = createSessionService({
    store,
    runner: {
      execute: async (payload) => {
        calls.push(payload.prompt);
        if (calls.length === 1) start.resolve();
        return gates[calls.length - 1].promise;
      },
      kill() {
        gates[1].resolve({ ok: false, error: "cancelled" });
      },
    },
  });
  const first = service.execute({
    sessionId: id,
    providerId: "claude",
    prompt: "first",
    responseMessageId: "queue-answer-1",
  });
  await start.promise;
  const second = service.execute({
    sessionId: id,
    providerId: "claude",
    prompt: "second",
    responseMessageId: "queue-answer-2",
  });
  const third = service.execute({
    sessionId: id,
    providerId: "claude",
    prompt: "third",
    responseMessageId: "queue-answer-3",
  });
  assert.deepEqual(calls, ["first"]);
  gates[0].resolve({ ok: true, output: "one" });
  assert.equal((await first).ok, true);
  while (calls.length < 2) await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, ["first", "second"]);
  assert.equal(
    (await store.getChatMessages(id)).filter((m) => m.id === "queue-answer-1")
      .length,
    1,
  );
  const removal = service.remove(id);
  assert.equal((await second).cancelled, true);
  assert.equal((await third).cancelled, true);
  await removal;
  assert.deepEqual(calls, ["first", "second"]);
  assert.equal(await store.sessionExists(id), false);
});
test("stop cancels the active turn and its queue, preserves partial output/native id, and accepts a fresh turn", async () => {
  const id = "review-stop-preserve";
  await store.saveSession(session(id));
  await store.setNativeSession(id, "claude", "native-stop-123", root);
  const gate = deferred(),
    started = deferred(),
    calls = [];
  const service = createSessionService({
    store,
    runner: {
      execute: async (p) => {
        calls.push(p.prompt);
        if (p.prompt === "active") {
          started.resolve();
          return gate.promise;
        }
        return {
          ok: true,
          output: "resumed",
          nativeSessionId: "native-stop-123",
        };
      },
      kill() {
        gate.resolve({
          ok: false,
          cancelled: true,
          output: "partial stdout",
          nativeSessionId: "native-stop-123",
        });
      },
    },
  });
  const first = service.execute({
    sessionId: id,
    providerId: "claude",
    prompt: "active",
    responseMessageId: "stop-active-answer",
  });
  await started.promise;
  const queued = service.execute({
    sessionId: id,
    providerId: "claude",
    prompt: "must not execute",
    responseMessageId: "stop-queued-answer",
  });
  const stopping = service.interrupt(id);
  assert.equal((await first).stopped, true);
  assert.equal((await queued).stopped, true);
  await stopping;
  assert.deepEqual(calls, ["active"]);
  assert.equal(
    (await store.getNativeSession(id, "claude")).nativeId,
    "native-stop-123",
  );
  assert.equal(await store.sessionExists(id), true);
  const history = await store.getChatMessages(id);
  assert.match(
    history.find((m) => m.id === "stop-active-answer").text,
    /partial stdout/,
  );
  assert.match(
    history.find((m) => m.id === "stop-queued-answer").text,
    /cancelado antes/,
  );
  assert.equal(
    (
      await service.execute({
        sessionId: id,
        providerId: "claude",
        prompt: "fresh",
        responseMessageId: "stop-resumed-answer",
      })
    ).ok,
    true,
  );
  assert.deepEqual(calls, ["active", "fresh"]);
});
test("stop is scoped to one conversation and cancels submissions arriving late from the renderer", async () => {
  const a = "review-stop-scope-a",
    b = "review-stop-scope-b";
  await store.saveSession(session(a));
  await store.saveSession(session(b));
  const active = deferred(),
    other = deferred(),
    startA = deferred(),
    startB = deferred(),
    calls = [];
  const service = createSessionService({
    store,
    runner: {
      execute: (p) => {
        calls.push(p.sessionId);
        (p.sessionId === a ? startA : startB).resolve();
        return p.sessionId === a ? active.promise : other.promise;
      },
      kill: (id) => {
        if (id === a) active.resolve({ ok: false, cancelled: true });
      },
    },
  });
  const one = service.execute({
      sessionId: a,
      providerId: "claude",
      prompt: "one",
    }),
    two = service.execute({ sessionId: b, providerId: "codex", prompt: "two" });
  await Promise.all([startA.promise, startB.promise]);
  await service.interrupt(a);
  assert.equal((await one).stopped, true);
  assert.equal(service.isBusy(), true);
  const late = await service.execute({
    sessionId: a,
    providerId: "claude",
    prompt: "late",
    cancelled: true,
    responseMessageId: "stop-late-answer",
  });
  assert.equal(late.stopped, true);
  assert.deepEqual([...calls].sort(), [a, b]);
  other.resolve({ ok: true, output: "other untouched" });
  assert.equal((await two).ok, true);
});
