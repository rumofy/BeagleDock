const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript");
const out = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/backgroundWork.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ctx = { exports: {} };
vm.runInNewContext(out, ctx);
const { backgroundWork, backgroundLabel } = ctx.exports;

const ev = (kind, status, background) => ({ id: Math.random().toString(), kind, title: "", status, ...(background ? { meta: { background: true } } : {}) });

test("conversa com comando ou agente em segundo plano depois da resposta não está parada", () => {
  const messages = [
    { id: "a", isStreaming: false, events: [ev("command", "running", true), ev("command", "done", true), ev("command", "running", false)] },
    { id: "b", isStreaming: false, events: [ev("agent", "running")] },
    // A resposta em andamento já aparece como execução; não conta duas vezes.
    { id: "c", isStreaming: true, events: [ev("command", "running", true)] },
  ];
  assert.deepEqual({ ...backgroundWork(messages) }, { commands: 1, agents: 1, total: 2 });
  assert.equal(backgroundWork(undefined).total, 0);
  assert.equal(backgroundLabel({ commands: 1, agents: 0 }), "1 comando em segundo plano");
  assert.equal(backgroundLabel({ commands: 2, agents: 1 }), "2 comandos e 1 agente em segundo plano");
});
