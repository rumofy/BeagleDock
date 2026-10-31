const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { EventEmitter } = require("node:events");
const ts = require("typescript");
const { createNativeCommands } = require("../electron/native-commands");

// Processo falso: cada chamada de `write` do stdin pode responder com linhas JSON.
function fakeSpawn(script, calls = []) {
  return (bin, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => (child.killed = true);
    const reply = (obj) => setImmediate(() => child.stdout.emit("data", JSON.stringify(obj) + "\n"));
    child.stdin = {
      end() {},
      write(line) {
        const msg = JSON.parse(line);
        calls.push({ bin, args, msg });
        script.onWrite?.(msg, reply);
      },
    };
    calls.push({ bin, args });
    setImmediate(() => script.onStart?.(reply, child));
    return child;
  };
}

test("Claude: comandos vêm do init de um comando local, sem chamar o modelo", async () => {
  const calls = [];
  const nc = createNativeCommands({
    find: () => "/bin/claude",
    spawn: fakeSpawn({ onStart: (reply) => { reply({ type: "system", subtype: "hook_started" }); reply({ type: "system", subtype: "init", model: "m1", permissionMode: "default", slash_commands: ["compact", "plan"], terminal_slash_commands: ["doctor", "compact"], skills: ["plan"] }); } }, calls),
  });
  const r = await nc.list("claude", "/p");
  assert.deepEqual(calls[0].args.slice(0, 2), ["-p", "/context"]);
  assert.deepEqual(r.commands.map((c) => [c.name, c.kind, !!c.terminalOnly]), [["compact", "command", true], ["plan", "skill", false], ["doctor", "command", true]]);
  assert.deepEqual(r.state, { model: "m1", permissionMode: "default" });
});

test("Antigravity: lê o command_result do /help, com apelidos e descrição", async () => {
  const nc = createNativeCommands({
    find: () => "/bin/agy",
    spawn: fakeSpawn({ onStart: (reply) => reply({ event: "command_result", command: { name: "help", data: { commands: [{ name: "config", aliases: ["settings"], description: "Abrir" }, { name: "/effort" }] } } }) }),
  });
  const r = await nc.list("antigravity", "/p");
  assert.deepEqual(r.commands, [{ name: "config", kind: "command", description: "Abrir", aliases: ["settings"] }, { name: "effort", kind: "command" }]);
});

test("Codex: skills/list do app-server e aviso de limitação", async () => {
  const nc = createNativeCommands({
    find: () => "/bin/codex",
    spawn: fakeSpawn({ onStart: (reply) => {}, onWrite: (msg, reply) => {
      if (msg.method === "initialize") reply({ id: msg.id, result: {} });
      if (msg.method === "skills/list") reply({ id: msg.id, result: { data: [{ cwd: "/p", skills: [{ name: "revisar", shortDescription: "Revisa" }, { name: "revisar" }] }] } });
    } }),
  });
  const r = await nc.list("codex", "/p");
  assert.deepEqual(r.commands, [{ name: "revisar", kind: "skill", description: "Revisa" }]);
  assert.match(r.limitation, /comandos internos/);
});

test("cache curto, atualização forçada e falhas viram ok:false sem lançar", async () => {
  let spawned = 0, time = 0;
  const spawn = (...a) => { spawned++; return fakeSpawn({ onStart: (reply) => reply({ event: "command_result", command: { name: "help", data: { commands: [{ name: "x" }] } } }) })(...a); };
  const nc = createNativeCommands({ find: () => "/bin/agy", spawn, now: () => time, ttlMs: 1000 });
  await nc.list("antigravity", "/p"); await nc.list("antigravity", "/p");
  assert.equal(spawned, 1);
  await nc.list("antigravity", "/p", { refresh: true });
  assert.equal(spawned, 2);
  time = 5000; await nc.list("antigravity", "/p");
  assert.equal(spawned, 3);
  const missing = await createNativeCommands({ find: () => null }).list("claude", "/p");
  assert.equal(missing.ok, false);
  assert.match(missing.error, /instalado/);
  assert.equal((await createNativeCommands({ find: () => "/x" }).list("openrouter", "/p")).ok, false);
});

test("autocomplete: consulta só no nome do comando e ordena por relevância", () => {
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve("src/hooks/useNativeCommands.ts"), "utf8").replace(/^import .*$/gm, ""), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const ctx = { exports: {}, RegExp };
  vm.runInNewContext(compiled, ctx);
  const { commandQuery, filterCommands } = ctx.exports;
  assert.equal(commandQuery("/mo"), "mo");
  assert.equal(commandQuery("/"), "");
  assert.equal(commandQuery("/model gpt"), null);
  assert.equal(commandQuery("olá /x"), null);
  assert.equal(commandQuery("src/app"), null);
  const names = filterCommands([{ name: "compact" }, { name: "model" }, { name: "remodel" }, { name: "x", description: "troca o MODEL" }, { name: "plan", aliases: ["mo"] }], "mo").map((c) => c.name);
  assert.deepEqual(names, ["plan", "model", "remodel", "x"].sort((a, b) => names.indexOf(a) - names.indexOf(b)));
  assert.deepEqual(names, ["plan", "model", "remodel", "x"]);
});

test("comandos que mudam o contexto da sessão apontam para o seletor do app", () => {
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/sessionControls.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ctx = { exports: {}, RegExp };
  vm.runInNewContext(compiled, ctx);
  const { controlForCommand } = ctx.exports;
  assert.equal(controlForCommand("/model"), "model");
  assert.equal(controlForCommand(" /Effort "), "effort");
  assert.equal(controlForCommand("/permissions"), "permission");
  assert.equal(controlForCommand("/model haiku"), null, "com argumento, vai para a CLI");
  assert.equal(controlForCommand("/status"), null);
  assert.equal(controlForCommand("model"), null);
});
