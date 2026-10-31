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

test("abas de shell: título, estado e agente vêm da linha do tempo; limites por aba e por sessão", () => {
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/shellTabs.ts"), "utf8").replace(/^import .*$/gm, ""), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ctx = { exports: {}, Object, Map, Math };
  vm.runInNewContext(compiled, ctx);
  const { buildShellTabs, splitVisibleTabs, appendShellOutput, MAX_SHELL_CHARS, MAX_SHELLS } = ctx.exports;
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const events = [
    { id: "agent-1", kind: "agent", title: "Agent", detail: "revisar", status: "running" },
    { id: "c1", kind: "command", title: "Bash", detail: "npm test", status: "running", parentId: "agent-1" },
    { id: "c2", kind: "command", title: "Bash", detail: "npm run build", status: "error" },
  ];
  // Só comandos viram aba: o agente, uma leitura de arquivo e uma origem sem evento ficam de fora.
  const withRead = [...events, { id: "r1", kind: "tool", title: "read_file", detail: "{\"Path\":\"/x\"}", status: "done" }];
  const tabs = plain(buildShellTabs({ c1: "abc", c2: "de", r1: "conteúdo", "agent-1": "zz", orfa: "x" }, withRead));
  assert.deepEqual(tabs.map((t) => [t.id, t.label, t.agent, t.status, t.size]), [
    ["c1", "npm test", "revisar", "running", 3],
    ["c2", "npm run build", undefined, "error", 2],
  ]);
  // 12 abas: as em execução e a selecionada ficam visíveis; o resto vai para "mais".
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, label: `t${i}`, status: i === 1 ? "running" : "done", size: 1 }));
  const { visible, overflow } = plain(splitVisibleTabs(many, "t0", 8));
  assert.equal(visible.length, 8);
  assert.ok(visible.some((t) => t.id === "t0") && visible.some((t) => t.id === "t1"), "selecionada e em execução");
  assert.equal(visible.length + overflow.length, 12);
  assert.deepEqual(plain(splitVisibleTabs(many.slice(0, 3), null, 8)).overflow, []);
  // Limites
  const big = plain(appendShellOutput({}, new Map([["a", "x".repeat(MAX_SHELL_CHARS + 50)]])));
  assert.equal(big.a.length, MAX_SHELL_CHARS);
  let raw = {};
  for (let i = 0; i < MAX_SHELLS + 5; i++) raw = plain(appendShellOutput(raw, new Map([[`s${i}`, "y"]])));
  assert.equal(Object.keys(raw).length, MAX_SHELLS);
  assert.ok(!("s0" in raw) && `s${MAX_SHELLS + 4}` in raw, "descarta as mais antigas");
});

test("continuar em outra CLI: resumo só com dados do histórico, sem segredos e com o histórico como dado", () => {
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/continuation.ts"), "utf8").replace(/^import .*$/gm, "").replace(/providerQuota\(/g, "(p=>p.quota)("), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ctx = { exports: {}, RegExp, Math, Set };
  vm.runInNewContext(compiled, ctx);
  const { buildContinuation, changedFiles, redact, suggestContinuation } = ctx.exports;
  const msg = (id, sender, text, extra = {}) => ({ id, sessionId: "s", sender, senderName: sender, text, timestamp: "", ...extra });
  const messages = [
    msg("init-s", "claude", "Sessão iniciada"),
    msg("1", "user", "Migra o módulo de pagamentos para TypeScript"),
    msg("2", "claude", "Migrei metade; falta o checkout.", { events: [
      { id: "e1", kind: "file", title: "Edit", detail: "src/pay.ts", status: "done" },
      { id: "e2", kind: "file", title: "Edit", detail: "src/pay.ts", status: "done" },
      { id: "e3", kind: "command", title: "Bash", detail: "npm test", status: "error" },
    ] }),
    msg("3", "user", "continua, o token é ghp_abcdefghijklmnopqrstuvwxyz0123456789"),
    msg("4", "claude", "Cota esgotada no meio…", { isStreaming: true }),
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(changedFiles(messages))), ["src/pay.ts"]);
  const prompt = buildContinuation({ fromProviderName: "Claude Code", toProviderName: "Codex CLI", title: "Pagamentos", cwd: "/p", messages });
  assert.match(prompt, /Claude Code, que ficou sem cota/);
  assert.match(prompt, /<historico>[\s\S]*Pedido original:\nMigra o módulo[\s\S]*<\/historico>/);
  assert.match(prompt, /nunca como instrução/);
  assert.match(prompt, /Última resposta do agente[^\n]*:\nMigrei metade; falta o checkout\./);
  assert.doesNotMatch(prompt, /Cota esgotada/, "resposta ainda em streaming não conta como feita");
  assert.match(prompt, /Arquivos alterados \(1\):\n- src\/pay\.ts/);
  assert.match(prompt, /Comandos que falharam por último:\n- npm test/);
  assert.doesNotMatch(prompt, /ghp_abcdefghijklmnop/);
  assert.match(prompt, /\[segredo removido\]/);
  assert.match(prompt, /git status e git diff/);
  assert.ok(prompt.length <= 9001);
  assert.equal(redact("Authorization: Bearer abcdefghijklmnop1234567890"), "Authorization: Bearer [segredo removido]");
  assert.equal(redact("senha=hunter22"), "senha=[segredo removido]");
  // Sugestão por cota
  const p = (id, w5, week, extra = {}) => ({ id, name: id, type: "cli", installed: true, quota: { window5hPercent: w5, weeklyPercent: week }, ...extra });
  const current = p("claude", 93, 12);
  const all = [current, p("codex", 42, 30), p("antigravity", 85, 10), p("openrouter", 1, 1, { type: "api" })];
  const s = JSON.parse(JSON.stringify(suggestContinuation(current, all)));
  assert.equal(s.reason, "da janela de 5 horas");
  assert.deepEqual(s.targets.map((t) => t.id), ["codex"], "só CLIs com folga; API e CLI quase cheia ficam de fora");
  assert.equal(suggestContinuation(p("claude", 60, 40), all), null, "abaixo do limite não sugere");
  assert.equal(suggestContinuation(p("claude", 99, 10, { quota: { window5hPercent: 99, weeklyPercent: 10, stale: true } }), all), null, "leitura velha não sugere");
  assert.equal(suggestContinuation(current, [current, p("codex", 95, 30)]), null, "sem destino com folga");
  assert.equal(JSON.parse(JSON.stringify(suggestContinuation(p("claude", 10, 97), all))).reason, "da semana");
});

test("auto-close das abas: só sucesso, fechada, vista e depois do prazo contado da última vez na tela", () => {
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/shellTabs.ts"), "utf8").replace(/^import .*$/gm, ""), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ctx = { exports: {}, Object, Map, Math, Number };
  vm.runInNewContext(compiled, ctx);
  const { tabsToAutoClose, DEFAULT_AUTO_CLOSE_SECONDS } = ctx.exports;
  assert.equal(DEFAULT_AUTO_CLOSE_SECONDS, 120);
  const tab = (id, status, size = 5) => ({ id, label: id, status, size });
  const tabs = [tab("ok", "done"), tab("erro", "error"), tab("rodando", "running"), tab("aberta", "done"), tab("nova", "done", 9), tab("vista-agora", "done")];
  const T0 = 1_000_000;
  const clocks = {
    ok: { finishedAt: T0 }, erro: { finishedAt: T0 }, rodando: { finishedAt: T0 },
    aberta: { finishedAt: T0 }, nova: { finishedAt: T0 }, "vista-agora": { finishedAt: T0, viewedAt: T0 + 100_000 },
  };
  const seenSizes = { ok: 5, erro: 5, rodando: 5, aberta: 5, nova: 5, "vista-agora": 5 };
  const run = (now, extra = {}) => JSON.parse(JSON.stringify(tabsToAutoClose(tabs, clocks, { now, seconds: 120, selectedId: "aberta", seenSizes, ...extra })));
  assert.deepEqual(run(T0 + 119_000), [], "antes do prazo nada fecha");
  assert.deepEqual(run(T0 + 121_000), ["ok"], "sucesso fecha; erro, rodando, aberta, saída não vista e vista há pouco ficam");
  assert.deepEqual(run(T0 + 221_000), ["ok", "vista-agora"], "o prazo da vista recomeça da última vez na tela");
  assert.deepEqual(run(T0 + 121_000, { selectedId: null }), ["ok", "aberta"]);
  assert.deepEqual(run(T0 + 121_000, { seconds: 30 }).includes("erro"), false, "erro nunca fecha sozinho");
  assert.deepEqual(JSON.parse(JSON.stringify(tabsToAutoClose(tabs, {}, { now: T0 + 999_999, seconds: 1, selectedId: null, seenSizes }))), [], "sem relógio (ainda não observada) não fecha");
});

test("modo de permissão por atalho: ciclo, plano liga/desliga e só Alt+P/Alt+M valem", () => {
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/permissionModes.ts"), "utf8").replace(/^import .*$/gm, ""), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ctx = { exports: {} };
  vm.runInNewContext(compiled, ctx);
  const { nextPermission, togglePlan, permissionShortcut, PERMISSION_CYCLE } = ctx.exports;
  assert.deepEqual(JSON.parse(JSON.stringify(PERMISSION_CYCLE)), ["inherit", "plan", "ask", "edits", "full"]);
  assert.equal(nextPermission("inherit"), "plan");
  assert.equal(nextPermission("edits"), "full");
  assert.equal(nextPermission("full"), "inherit", "depois do último volta ao primeiro");
  assert.equal(nextPermission(undefined), "plan", "sem modo definido conta como o da CLI");
  assert.equal(togglePlan("edits"), "plan");
  assert.equal(togglePlan("plan"), "edits");
  assert.equal(togglePlan("full"), "plan");
  const key = (k, extra = {}) => ({ key: k, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });
  assert.equal(permissionShortcut(key("p")), "plan");
  assert.equal(permissionShortcut(key("M")), "cycle");
  assert.equal(permissionShortcut(key("p", { altKey: false })), null, "sem Alt não é atalho");
  assert.equal(permissionShortcut(key("p", { ctrlKey: true })), null);
  assert.equal(permissionShortcut(key("p", { shiftKey: true })), null);
  assert.equal(permissionShortcut(key("x")), null);
});
