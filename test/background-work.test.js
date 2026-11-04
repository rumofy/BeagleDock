const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./load-ts.cjs");
const { backgroundWork, backgroundLabel } = loadTs("src/lib/backgroundWork.ts");

const ev = (kind, status, background) => ({ id: Math.random().toString(), kind, title: "", status, ...(background ? { meta: { background: true } } : {}) });

test("a conversation with a background command or agent after the reply isn't idle", () => {
  const messages = [
    { id: "a", isStreaming: false, events: [ev("command", "running", true), ev("command", "done", true), ev("command", "running", false)] },
    { id: "b", isStreaming: false, events: [ev("agent", "running")] },
    // The reply in progress already shows as running; it doesn't count twice.
    { id: "c", isStreaming: true, events: [ev("command", "running", true)] },
  ];
  assert.deepEqual({ ...backgroundWork(messages) }, { commands: 1, agents: 1, total: 2 });
  assert.equal(backgroundWork(undefined).total, 0);
  assert.equal(backgroundLabel({ commands: 1, agents: 0 }), "1 command in the background");
  assert.equal(backgroundLabel({ commands: 2, agents: 1 }), "2 commands and 1 agent in the background");
});
