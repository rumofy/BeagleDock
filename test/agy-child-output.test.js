const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAgyChildOutput } = require("../electron/agy-child-output");

test("AGY: transcript do filho mostra só comandos e saída, com JSON parcial e snapshots repetidos", () => {
  const commands = [], output = [], started = [], ended = [];
  let finished = null;
  const read = createAgyChildOutput({
    onCommand: (c) => commands.push(c),
    onOutput: (s) => output.push(s),
    onToolStart: (t) => started.push(t),
    onToolEnd: (t) => ended.push(t),
    onFinish: (c) => (finished = c),
  });
  const plan = { step_index: 2, type: "PLANNER_RESPONSE", tool_calls: [{ name: "run_command", args: { CommandLine: JSON.stringify("npm test") } }] };
  const result = { step_index: 3, type: "GENERIC", content: "Created At: now\nCommand output:\nFIRST\n" };
  const line = (s) => JSON.stringify(s) + "\n";
  const data = line({ step_index: 0, type: "SYSTEM_MESSAGE", content: "PRIVATE_SYSTEM_PROMPT" }) + line(plan) + line(result);
  read(data.slice(0, 45));
  read(data.slice(45));
  assert.deepEqual(commands, ["npm test"]);
  assert.deepEqual(output, ["FIRST\n"]);
  assert.equal(started.length, 1);
  assert.equal(started[0].command, "npm test");
  assert.equal(ended.length, 1);
  assert.equal(ended[0].status, "done");
  read(line(plan) + line(result));
  read(line({ ...result, content: result.content + "LAST\n" }));
  read(line({ step_index: 4, type: "PLANNER_RESPONSE", content: "PRIVATE_REASONING", tool_calls: [{ name: "read_file", args: {} }] }));
  read(line({ step_index: 5, type: "GENERIC", content: "Command output:\nPRIVATE_FILE" }));
  read(line({ step_index: 6, type: "PLANNER_RESPONSE", status: "DONE", content: "Concluído." }));
  assert.deepEqual(commands, ["npm test"]);
  assert.equal(output.join(""), "FIRST\nLAST\n");
  assert.equal(finished, "Concluído.");
});

test("AGY: transcript não duplica saída já recebida pelo log incremental", () => {
  const output = [];
  const read = createAgyChildOutput({ onCommand() {}, onOutput: (s) => output.push(s), hasLiveOutput: (step) => step === 3 });
  read(JSON.stringify({ step_index: 2, type: "PLANNER_RESPONSE", tool_calls: [{ name: "run_command", args: { CommandLine: "npm test" } }] }) + "\n");
  read(JSON.stringify({ step_index: 3, type: "GENERIC", content: "Command output:\nALREADY_STREAMED" }) + "\n");
  assert.deepEqual(output, []);
});
