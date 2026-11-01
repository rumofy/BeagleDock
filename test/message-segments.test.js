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

test("trechos: o separador é o mesmo no backend e na tela", () => {
  assert.equal(SEGMENT_MARK, backend.SEGMENT_MARK);
  assert.equal(SEGMENT_SEPARATOR, backend.SEGMENT_SEPARATOR);
});

test("trechos: a tela divide por separador e texto antigo continua uma caixa só", () => {
  assert.deepEqual([...messageSegments("um\n\ndois")], ["um\n\ndois"], "parágrafos comuns não viram caixas");
  assert.deepEqual([...messageSegments(`um${SEGMENT_SEPARATOR}dois\n\nainda dois${SEGMENT_SEPARATOR}três`)], ["um", "dois\n\nainda dois", "três"]);
  assert.deepEqual([...messageSegments(`um${SEGMENT_SEPARATOR}`)], ["um"], "trecho vazio no fim some");
  assert.deepEqual([...messageSegments("")], [""]);
});

test("trechos: texto limpo para cópia, notificação e continuação em outra CLI", () => {
  const text = `um${SEGMENT_SEPARATOR}dois`;
  assert.equal(plainMessageText(text), "um\n\ndois");
  assert.equal(backend.plainText(text), "um\n\ndois");
  assert.equal(backend.plainText(`a${SEGMENT_MARK}b`), "ab");
});
