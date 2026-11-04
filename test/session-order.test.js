const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./load-ts.cjs");
const { sortByLastUpdate } = loadTs("src/lib/sessionOrder.ts");
const { hasLiveReply } = loadTs("src/lib/backgroundWork.ts");

test("sidebar lists the most recently updated conversation first, keeping ties in place", () => {
  const sessions = [
    { id: "old", lastMessageAt: 1_000 },
    { id: "none-a" },
    { id: "new", lastMessageAt: 3_000 },
    { id: "mid", lastMessageAt: 2_000 },
    { id: "none-b" },
  ];
  assert.deepEqual([...sortByLastUpdate(sessions).map((s) => s.id)], ["new", "mid", "old", "none-a", "none-b"]);
  // Does not mutate the original list (it is React state).
  assert.equal(sessions[0].id, "old");
});

test("a turn the CLI started on its own counts as running; a queued reply does not", () => {
  assert.equal(hasLiveReply(undefined), false);
  assert.equal(hasLiveReply([{ id: "a", isStreaming: false }]), false);
  assert.equal(hasLiveReply([{ id: "auto-1", isStreaming: true }]), true);
  assert.equal(hasLiveReply([{ id: "q", isStreaming: true, queuedFor: "usr-1" }]), false);
});
