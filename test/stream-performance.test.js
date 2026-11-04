// Streaming delay budget: the cost of applying a frame of events and preparing the text
// (code blocks + highlighting) in a heavy conversation must fit comfortably in one frame (16 ms).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const ts = require("typescript");
function load(file) {
  const out = ts.transpileModule(fs.readFileSync(path.resolve(file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ctx = { exports: {}, RegExp, Set, Map, Math, Number, setTimeout, clearTimeout, performance };
  vm.runInNewContext(out, ctx);
  return ctx.exports;
}
const { applyStreamItems } = load("src/lib/streamApply.ts");
const { createFrameBatcher } = load("src/lib/frameBatcher.ts");
const { splitMessage } = load("src/lib/codeBlocks.ts");
const { tokenize } = load("src/lib/highlight.ts");
const { buildEventTree } = load("src/lib/eventTree.ts");

const FRAME_BUDGET_MS = 16;
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1)];

function heavyConversation() {
  const messages = [];
  for (let i = 0; i < 400; i++)
    messages.push({
      id: `m${i}`, sessionId: "s1", sender: i % 2 ? "claude" : "user", senderName: "x",
      text: "Texto da mensagem número " + i + ". ".repeat(1) + "lorem ipsum dolor sit amet ".repeat(80),
      timestamp: "", isStreaming: false,
      events: i % 2 ? Array.from({ length: 30 }, (_, k) => ({ id: `e${i}-${k}`, kind: "command", title: "Bash", status: "done", ...(k % 5 === 4 ? { parentId: `e${i}-${k - 1}` } : {}) })) : undefined,
    });
  messages.push({ id: "live", sessionId: "s1", sender: "claude", senderName: "x", text: "", timestamp: "", isStreaming: true, startedAt: 0 });
  return { s1: messages };
}

test("streaming frames in a heavy conversation fit in one frame's budget", () => {
  let state = heavyConversation();
  const flushDurations = [];
  const flushes = [];
  let run;
  const batcher = createFrameBatcher((items) => {
    const t0 = performance.now();
    state = applyStreamItems(state, items, Date.now());
    flushDurations.push(performance.now() - t0);
    flushes.push(items.length);
  }, (cb) => (run = cb));
  let text = "";
  const CHUNKS = 6000;
  for (let i = 0; i < CHUNKS; i++) {
    text += i % 40 === 39 ? "palavra de teste com um pouco mais de texto\n" : "token e mais um trecho de texto ".repeat(2);
    batcher.push({ kind: "chunk", payload: { sessionId: "s1", responseMessageId: "live", fullText: text, activity: "IA respondendo…" }, receivedAt: 0 });
    if (i % 25 === 24) run(); // ~25 events per frame: a very fast stream
  }
  if (run) run();
  assert.ok(text.length > 150_000, "the reply grew to hundreds of KB");
  assert.equal(state.s1.at(-1).text, text);
  const p95 = percentile(flushDurations, 95);
  const max = Math.max(...flushDurations);
  console.log(`apply per frame (${flushDurations.length} frames, ${(text.length / 1024).toFixed(0)} KB): p95=${p95.toFixed(2)} ms, max=${max.toFixed(2)} ms`);
  // The cost of copying the list and the streaming message is small; the limit has slow-machine headroom.
  assert.ok(p95 < FRAME_BUDGET_MS / 4, `p95 ${p95.toFixed(2)} ms went past a quarter frame`);
  assert.ok(max < FRAME_BUDGET_MS, `worst frame ${max.toFixed(2)} ms went past one frame`);
});

test("preparing the text of a reply with an open code block fits in the frame (real text and code)", () => {
  const prose = "Explicação do que foi feito, com detalhes do porquê. ".repeat(20) + "\n";
  const code = (n) => Array.from({ length: n }, (_, i) => `function f${i}(a, b) { return a + b * ${i}; } // linha ${i}`).join("\n");
  const durations = [];
  // Typical reply: text, a closed ~8 KB block and an open block growing to ~20 KB.
  const closed = "```ts\n" + code(100) + "\n```\n";
  let open = "";
  for (let step = 0; step < 60; step++) {
    open += code(5) + "\n";
    const message = prose + closed + prose + "```js\n" + open;
    const t0 = performance.now();
    const parts = splitMessage(message);
    for (const part of parts) if (part.type === "code") tokenize(part.code, part.lang);
    durations.push(performance.now() - t0);
  }
  const max = Math.max(...durations);
  const p95 = percentile(durations, 95);
  console.log(`text+highlight per frame (open block up to ${(open.length / 1024).toFixed(0)} KB): p95=${p95.toFixed(2)} ms, max=${max.toFixed(2)} ms`);
  assert.ok(p95 < FRAME_BUDGET_MS, `p95 ${p95.toFixed(2)} ms went past one frame`);
});

test("building the step tree of a reply with many agents and steps is cheap", () => {
  const events = [];
  for (let a = 0; a < 40; a++) {
    events.push({ id: `a${a}`, kind: "agent", title: "Agente", status: "done" });
    for (let k = 0; k < 20; k++) events.push({ id: `a${a}-${k}`, parentId: `a${a}`, kind: "command", title: "Bash", status: "done" });
  }
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) buildEventTree(events);
  const each = (performance.now() - t0) / 50;
  console.log(`tree of ${events.length} steps: ${each.toFixed(3)} ms`);
  assert.ok(each < FRAME_BUDGET_MS / 2);
});

test("pathological text doesn't hang the block and link detectors (no catastrophic backtracking)", () => {
  const { splitFileLinks } = load("src/lib/fileLinks.ts");
  for (const hostile of ["a/".repeat(20000), "a.".repeat(20000) + "x", "/".repeat(50000), "`".repeat(30000), "```\n".repeat(5000), ("src/" + "b".repeat(100) + "/").repeat(500) + "!"]) {
    const t0 = performance.now();
    splitMessage(hostile);
    splitFileLinks(hostile);
    tokenize(hostile, "ts");
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `entrada hostil levou ${ms.toFixed(0)} ms`);
  }
});
