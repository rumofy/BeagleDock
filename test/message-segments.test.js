const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript");
const backend = require("../electron/message-segments");

const out = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/messageSegments.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ctx = { exports: {}, String };
vm.runInNewContext(out, ctx);
const { SEGMENT_MARK, SEGMENT_SEPARATOR, messageSegments, plainMessageText } = ctx.exports;

test("segments: the separator is the same in the backend and on screen", () => {
  assert.equal(SEGMENT_MARK, backend.SEGMENT_MARK);
  assert.equal(SEGMENT_SEPARATOR, backend.SEGMENT_SEPARATOR);
});

test("segments: the screen splits by separator and old text stays a single box", () => {
  assert.deepEqual([...messageSegments("um\n\ndois")], ["um\n\ndois"], "ordinary paragraphs don't become boxes");
  assert.deepEqual([...messageSegments(`um${SEGMENT_SEPARATOR}dois\n\nainda dois${SEGMENT_SEPARATOR}três`)], ["um", "dois\n\nainda dois", "três"]);
  assert.deepEqual([...messageSegments(`um${SEGMENT_SEPARATOR}`)], ["um"], "an empty segment at the end vanishes");
  assert.deepEqual([...messageSegments("")], [""]);
});

test("segments: clean text for copying, notifications and continuing in another CLI", () => {
  const text = `um${SEGMENT_SEPARATOR}dois`;
  assert.equal(plainMessageText(text), "um\n\ndois");
  assert.equal(backend.plainText(text), "um\n\ndois");
  assert.equal(backend.plainText(`a${SEGMENT_MARK}b`), "ab");
});
