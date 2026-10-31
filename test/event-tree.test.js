const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript");
const out = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/eventTree.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ctx = { exports: {}, Map, Set };
vm.runInNewContext(out, ctx);
const { buildEventTree } = ctx.exports;
const e = (id, parentId) => ({ id, parentId, kind: "tool", title: id, status: "done" });
const ids = (list) => JSON.parse(JSON.stringify(list.map((x) => x.id)));

test("etapas de agente ficam sob o agente, na ordem em que chegaram", () => {
  const { roots, tree } = buildEventTree([e("agent"), e("a", "agent"), e("solta"), e("b", "agent")]);
  assert.deepEqual(ids(roots), ["agent", "solta"]);
  assert.deepEqual(ids(tree.get("agent")), ["a", "b"]);
});

test("agentes dentro de agentes formam níveis", () => {
  const { roots, tree } = buildEventTree([e("raiz"), e("filho", "raiz"), e("neto", "filho")]);
  assert.deepEqual(ids(roots), ["raiz"]);
  assert.deepEqual(ids(tree.get("filho")), ["neto"]);
});

test("pai ausente, o próprio id ou ciclo não somem nem travam: vão para a raiz", () => {
  const { roots } = buildEventTree([e("orfa", "nao-existe"), e("si", "si"), e("a", "b"), e("b", "a")]);
  assert.deepEqual(ids(roots), ["orfa", "si", "a", "b"]);
});
