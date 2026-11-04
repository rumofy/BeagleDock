const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript");

const out = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/textSearch.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ctx = { exports: {}, String };
vm.runInNewContext(out, ctx);
const { findMatches, stepMatch } = ctx.exports;

const pieces = (text, query) => [...findMatches(text, query)].map(({ start, end }) => text.slice(start, end));

test("search in the conversation: ignores case and accents and returns the original fragment", () => {
  assert.deepEqual(pieces("Ação, acao e AÇÃO", "acao"), ["Ação", "acao", "AÇÃO"]);
  assert.deepEqual(pieces("configuração", "Ção"), ["ção"]);
  assert.deepEqual(pieces("O café é bom", "CAFE"), ["café"]);
});

test("search in the conversation: a decomposed accent (NFD) is also highlighted whole", () => {
  const text = "ação"; // "ação" with combining accents
  assert.deepEqual(pieces(text, "acao"), [text]);
  assert.deepEqual(pieces(text, "ç"), ["ç"]);
});

test("search in the conversation: non-overlapping matches and an empty query finds nothing", () => {
  assert.deepEqual(pieces("aaaa", "aa"), ["aa", "aa"]);
  assert.equal(findMatches("qualquer texto", "   ").length, 0);
  assert.equal(findMatches("", "x").length, 0);
  assert.deepEqual(pieces("  erro  ", " erro "), ["erro"], "spaces at the ends of the query are ignored");
});

test("search in the conversation: characters outside the BMP don't misalign the highlight", () => {
  const text = "🐶 BeagleDock 🐶 beagle";
  assert.deepEqual(pieces(text, "beagle"), ["Beagle", "beagle"]);
});

test("search in the conversation: navigation wraps around the ends", () => {
  assert.equal(stepMatch(0, 3, 1), 1);
  assert.equal(stepMatch(2, 3, 1), 0);
  assert.equal(stepMatch(0, 3, -1), 2);
  assert.equal(stepMatch(-1, 3, 1), 0);
  assert.equal(stepMatch(-1, 3, -1), 2);
  assert.equal(stepMatch(0, 0, 1), -1);
});
