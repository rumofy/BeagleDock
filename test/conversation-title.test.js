const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript");
const out = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/conversationTitle.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ctx = { exports: {}, RegExp };
vm.runInNewContext(out, ctx);
const { conversationTitle } = ctx.exports;

test("título genérico vira o assunto do primeiro pedido com conteúdo", () => {
  assert.equal(conversationTitle("Nova sessão #1", "corrige o login"), "corrige o login");
  assert.equal(conversationTitle("Nova sessão #1", "oi"), "Nova sessão #1");
});

test("comandos (/compact, /handoff) não viram título", () => {
  assert.equal(conversationTitle("Nova sessão #2", "/compact"), "Nova sessão #2");
  assert.equal(conversationTitle("Nova sessão #2", "  /handoff agora"), "Nova sessão #2");
});

test("título que não é genérico nunca é trocado", () => {
  assert.equal(conversationTitle("Refatorar billing", "outro assunto"), "Refatorar billing");
});
