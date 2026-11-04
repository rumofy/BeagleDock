const { test } = require("node:test");
const assert = require("node:assert/strict");
const { userQuestions, validateAnswers, claudeAnswers } = require("../electron/user-questions");
const { createApprovalBroker } = require("../electron/approvals");

test("questions normalize Claude, Codex and AGY formats while preserving labels and IDs", () => {
  for (const [input, id, multi] of [
    [{ questions: [{ question: "Channel?", header: "Channel", options: [{ label: "Email (Recommended)", description: "Existing channel" }], multiSelect: true }] }, "0", true],
    [{ questions: [{ id: "native-channel", question: "Channel?", options: [{ label: "Email (Recommended)", description: "Existing channel" }] }] }, "native-channel", false],
    [{ questions: [{ question: "Channel?", options: ["Email (Recommended)"], is_multi_select: true }] }, "0", true],
  ]) {
    const [q] = userQuestions(JSON.stringify(input));
    assert.equal(q.id, id);
    assert.equal(q.multiSelect, multi);
    assert.equal(q.options[0].label, "Email (Recommended)");
    const answers = validateAnswers([q], { [id]: ["Email (Recommended)"] });
    assert.deepEqual(claudeAnswers([q], answers), { "Channel?": "Email (Recommended)" });
  }
  assert.deepEqual(userQuestions("invalid"), []);
});

test("question broker requires every answer, rejects permission shortcuts, and preserves custom/multiple answers", async () => {
  const broker = createApprovalBroker();
  const pending = broker.askDetailed({ sessionId: "s", providerId: "claude", kind: "question", input: {
    questions: [
      { question: "Channels?", multiSelect: true, options: ["Email", "WhatsApp"] },
      { id: "details", question: "Details?" },
    ],
  } });
  const [{ id, questions }] = broker.list();
  assert.equal(questions.length, 2);
  assert.equal(broker.approveSession("s"), 0);
  for (const decision of ["allow", "accept", "answer"])
    assert.throws(() => broker.resolve(id, decision));
  for (const answers of [{ 0: ["Email"] }, { 0: ["Email"], details: [""] }, { 0: ["Email"], details: ["a", "b"] }])
    assert.throws(() => broker.resolve(id, "answer", { answers }));
  const answers = { 0: ["Email", "WhatsApp", "Another channel"], details: ["Keep my wording\nwith a newline"] };
  assert.equal(broker.resolve(id, "answer", { answers }).ok, true);
  const decision = await pending;
  assert.equal(decision.allow, true);
  assert.deepEqual({ ...decision.answers }, answers);
  assert.equal(broker.resolve(id, "answer", { answers }).ok, false);
});

test("dismissing or stopping a question never supplies an answer", async () => {
  const broker = createApprovalBroker();
  for (const cancel of [false, true]) {
    const pending = broker.askDetailed({ sessionId: "s", providerId: "codex", kind: "question", input: { questions: [{ id: "q", question: "Why?" }] } });
    if (cancel) broker.cancelSession("s");
    else broker.resolve(broker.list()[0].id, "deny");
    const result = await pending;
    assert.equal(result.allow, false);
    assert.equal(result.answers, undefined);
  }
});
