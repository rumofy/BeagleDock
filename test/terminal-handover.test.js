const test = require("node:test");
const assert = require("node:assert/strict");
const { createTerminalHandover } = require("../electron/terminal-handover");

// A desktop with one conversation open in the CLI's terminal; records what the handover does.
function setup({ status = "idle", open = true, pendingSync = null } = {}) {
  const state = { status, open, pendingSync, log: [] };
  const handover = createTerminalHandover({
    isOpen: () => state.open,
    status: () => state.status,
    pendingSync: () => state.pendingSync,
    close: (id) => {
      state.log.push(["close", id]);
      state.open = false;
    },
    endHistory: async (id) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      state.log.push(["history", id]);
    },
    notifyClosed: (id) => state.log.push(["closed", id]),
    busyError: () => "busy",
  });
  return { state, handover };
}

for (const providerId of ["claude", "codex", "antigravity"]) {
  test(`${providerId}: an idle terminal closes, saves its last messages and tells the desktop before the chat turn`, async () => {
    const { state, handover } = setup();
    assert.deepEqual(await handover.handOver(providerId), { ok: true });
    assert.deepEqual(state.log, [["close", providerId], ["history", providerId], ["closed", providerId]]);
  });

  test(`${providerId}: a terminal replying or waiting for an answer is left alone`, async () => {
    for (const status of ["running", "waiting_input"]) {
      const { state, handover } = setup({ status });
      assert.deepEqual(await handover.handOver(providerId), { ok: false, error: "busy" });
      assert.equal(state.open, true, `${status}: the CLI keeps running`);
      assert.deepEqual(state.log, []);
    }
  });
}

test("without a terminal open there is nothing to hand over", async () => {
  const { state, handover } = setup({ open: false });
  assert.deepEqual(await handover.handOver("s"), { ok: true });
  assert.deepEqual(state.log, []);
});

test("the end-of-turn sync still retrying finishes before the terminal closes", async () => {
  let finishSync;
  const sync = new Promise((resolve) => (finishSync = resolve)).then(() => {
    state.log.push(["turn sync"]);
  });
  const { state, handover } = setup({ pendingSync: sync });
  const result = handover.handOver("s");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(state.log, [], "nothing closes while the last reply may still be on its way");
  finishSync();
  assert.deepEqual(await result, { ok: true });
  assert.deepEqual(state.log, [["turn sync"], ["close", "s"], ["history", "s"], ["closed", "s"]]);
});

test("a turn that started while the sync finished keeps the terminal", async () => {
  let finishSync;
  const { state, handover } = setup({ pendingSync: new Promise((resolve) => (finishSync = resolve)) });
  const result = handover.handOver("s");
  state.status = "running";
  finishSync();
  assert.deepEqual(await result, { ok: false, error: "busy" });
  assert.equal(state.open, true);
});

test("a second message waits for the handover instead of overtaking it", async () => {
  const { state, handover } = setup();
  const order = [];
  const first = handover.handOver("s").then((r) => (order.push("first"), r));
  const second = handover.handOver("s").then((r) => (order.push("second"), r));
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
  assert.deepEqual(order, ["first", "second"]);
  assert.deepEqual(state.log.filter(([step]) => step === "close"), [["close", "s"]], "the terminal closes once");
});
