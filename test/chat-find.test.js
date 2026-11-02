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

test("busca na conversa: ignora maiúsculas e acentos e devolve o trecho original", () => {
  assert.deepEqual(pieces("Ação, acao e AÇÃO", "acao"), ["Ação", "acao", "AÇÃO"]);
  assert.deepEqual(pieces("configuração", "Ção"), ["ção"]);
  assert.deepEqual(pieces("O café é bom", "CAFE"), ["café"]);
});

test("busca na conversa: acento decomposto (NFD) também é realçado por inteiro", () => {
  const text = "ação"; // "ação" com acentos combinantes
  assert.deepEqual(pieces(text, "acao"), [text]);
  assert.deepEqual(pieces(text, "ç"), ["ç"]);
});

test("busca na conversa: ocorrências sem sobreposição e consulta vazia não acha nada", () => {
  assert.deepEqual(pieces("aaaa", "aa"), ["aa", "aa"]);
  assert.equal(findMatches("qualquer texto", "   ").length, 0);
  assert.equal(findMatches("", "x").length, 0);
  assert.deepEqual(pieces("  erro  ", " erro "), ["erro"], "espaços nas pontas da consulta são ignorados");
});

test("busca na conversa: caracteres fora do BMP não desalinham o realce", () => {
  const text = "🐶 BeagleDock 🐶 beagle";
  assert.deepEqual(pieces(text, "beagle"), ["Beagle", "beagle"]);
});

test("busca na conversa: navegação dá a volta nas pontas", () => {
  assert.equal(stepMatch(0, 3, 1), 1);
  assert.equal(stepMatch(2, 3, 1), 0);
  assert.equal(stepMatch(0, 3, -1), 2);
  assert.equal(stepMatch(-1, 3, 1), 0);
  assert.equal(stepMatch(-1, 3, -1), 2);
  assert.equal(stepMatch(0, 0, 1), -1);
});
