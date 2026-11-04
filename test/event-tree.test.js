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

test("agent steps stay under the agent, in the order they arrived", () => {
  const { roots, tree } = buildEventTree([e("agent"), e("a", "agent"), e("solta"), e("b", "agent")]);
  assert.deepEqual(ids(roots), ["agent", "solta"]);
  assert.deepEqual(ids(tree.get("agent")), ["a", "b"]);
});

test("agents inside agents form levels", () => {
  const { roots, tree } = buildEventTree([e("raiz"), e("filho", "raiz"), e("neto", "filho")]);
  assert.deepEqual(ids(roots), ["raiz"]);
  assert.deepEqual(ids(tree.get("filho")), ["neto"]);
});

test("a missing parent, its own id or a cycle don't vanish or hang: they go to the root", () => {
  const { roots } = buildEventTree([e("orfa", "nao-existe"), e("si", "si"), e("a", "b"), e("b", "a")]);
  assert.deepEqual(ids(roots), ["orfa", "si", "a", "b"]);
});
