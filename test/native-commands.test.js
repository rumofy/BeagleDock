const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { EventEmitter } = require("node:events");
const ts = require("typescript");
const { loadTs } = require("./load-ts.cjs");
const { createNativeCommands } = require("../electron/native-commands");

// Fake process: each stdin `write` call can answer with JSON lines.
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

test("Claude: commands come from the init of a local command, without calling the model", async () => {
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

test("Antigravity: reads the command_result of /help, with aliases and description", async () => {
  const nc = createNativeCommands({
    find: () => "/bin/agy",
    spawn: fakeSpawn({ onStart: (reply) => reply({ event: "command_result", command: { name: "help", data: { commands: [{ name: "config", aliases: ["settings"], description: "Abrir" }, { name: "/effort" }] } } }) }),
  });
  const r = await nc.list("antigravity", "/p");
  assert.deepEqual(r.commands, [{ name: "config", kind: "command", description: "Abrir", aliases: ["settings"] }, { name: "effort", kind: "command" }]);
});

test("Codex: the app-server's skills/list and a limitation notice", async () => {
  const nc = createNativeCommands({
    find: () => "/bin/codex",
    spawn: fakeSpawn({ onStart: (reply) => {}, onWrite: (msg, reply) => {
      if (msg.method === "initialize") reply({ id: msg.id, result: {} });
      if (msg.method === "skills/list") reply({ id: msg.id, result: { data: [{ cwd: "/p", skills: [{ name: "revisar", shortDescription: "Revisa" }, { name: "revisar" }] }] } });
    } }),
  });
  const r = await nc.list("codex", "/p");
  assert.deepEqual(r.commands, [{ name: "revisar", kind: "skill", description: "Revisa" }]);
  assert.match(r.limitation, /built-in commands/);
});

test("short cache, forced refresh and failures become ok:false without throwing", async () => {
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
  assert.match(missing.error, /installed/);
  assert.equal((await createNativeCommands({ find: () => "/x" }).list("openrouter", "/p")).ok, false);
});

test("autocomplete: queries only the command name and sorts by relevance", () => {
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

test("commands that change the session's context point to the app's picker", () => {
  const { controlForCommand } = loadTs("src/lib/sessionControls.ts");
  assert.equal(controlForCommand("/model"), "model");
  assert.equal(controlForCommand(" /Effort "), "effort");
  assert.equal(controlForCommand("/permissions"), "permission");
  assert.equal(controlForCommand("/model haiku"), null, "with an argument, it goes to the CLI");
  assert.equal(controlForCommand("/status"), null);
  assert.equal(controlForCommand("model"), null);
});

test("shell tabs: title, state and agent come from the timeline; limits per tab and per session", () => {
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
  // Only commands become tabs: the agent, a file read and a source without an event are left out.
  const withRead = [...events, { id: "r1", kind: "tool", title: "read_file", detail: "{\"Path\":\"/x\"}", status: "done" }];
  const tabs = plain(buildShellTabs({ c1: "abc", c2: "de", r1: "conteúdo", "agent-1": "zz", orfa: "x" }, withRead));
  assert.deepEqual(tabs.map((t) => [t.id, t.label, t.agent, t.status, t.size]), [
    ["c1", "npm test", "revisar", "running", 3],
    ["c2", "npm run build", undefined, "error", 2],
  ]);
  // 12 tabs: the running ones and the selected one stay visible; the rest goes to "more".
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, label: `t${i}`, status: i === 1 ? "running" : "done", size: 1 }));
  const { visible, overflow } = plain(splitVisibleTabs(many, "t0", 8));
  assert.equal(visible.length, 8);
  assert.ok(visible.some((t) => t.id === "t0") && visible.some((t) => t.id === "t1"), "selected and running");
  assert.equal(visible.length + overflow.length, 12);
  assert.deepEqual(plain(splitVisibleTabs(many.slice(0, 3), null, 8)).overflow, []);
  // Limits
  const big = plain(appendShellOutput({}, new Map([["a", "x".repeat(MAX_SHELL_CHARS + 50)]])));
  assert.equal(big.a.length, MAX_SHELL_CHARS);
  let raw = {};
  for (let i = 0; i < MAX_SHELLS + 5; i++) raw = plain(appendShellOutput(raw, new Map([[`s${i}`, "y"]])));
  assert.equal(Object.keys(raw).length, MAX_SHELLS);
  assert.ok(!("s0" in raw) && `s${MAX_SHELLS + 4}` in raw, "drops the oldest");
});

test("continue in another CLI: summary only with history data, without secrets and with the history as data", () => {
  const { buildContinuation, changedFiles, redact, suggestContinuation } = loadTs("src/lib/continuation.ts");
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
  assert.match(prompt, /Claude Code, which ran out of quota/);
  assert.match(prompt, /<history>[\s\S]*Original request:\nMigra o módulo[\s\S]*<\/history>/);
  assert.match(prompt, /never as instructions/);
  assert.match(prompt, /Agent's last reply[^\n]*:\nMigrei metade; falta o checkout\./);
  assert.doesNotMatch(prompt, /Cota esgotada/, "a reply still streaming doesn't count as done");
  assert.match(prompt, /Changed files \(1\):\n- src\/pay\.ts/);
  assert.match(prompt, /Commands that failed most recently:\n- npm test/);
  assert.doesNotMatch(prompt, /ghp_abcdefghijklmnop/);
  assert.match(prompt, /\[secret removed\]/);
  assert.match(prompt, /git status and git diff/);
  assert.ok(prompt.length <= 9001);
  assert.equal(redact("Authorization: Bearer abcdefghijklmnop1234567890"), "Authorization: Bearer [secret removed]");
  assert.equal(redact("senha=hunter22"), "senha=[secret removed]");
  // Suggestion by quota
  const p = (id, w5, week, extra = {}) => ({ id, name: id, type: "cli", installed: true, quota: { window5hPercent: w5, weeklyPercent: week }, ...extra });
  const current = p("claude", 93, 12);
  const all = [current, p("codex", 42, 30), p("antigravity", 0, 0, { quota: { groups: [{ name: "Gemini Models", window5hPercent: 85, weeklyPercent: 10 }] } }), p("openrouter", 1, 1, { type: "api" })];
  const s = JSON.parse(JSON.stringify(suggestContinuation(current, all)));
  assert.equal(s.reason, "of the 5-hour window");
  assert.deepEqual(s.targets.map((t) => t.id), ["codex"], "only CLIs with room; the API and the nearly full CLI are left out");
  assert.equal(suggestContinuation(p("claude", 60, 40), all), null, "below the limit it doesn't suggest");
  assert.equal(suggestContinuation(p("claude", 99, 10, { quota: { window5hPercent: 99, weeklyPercent: 10, stale: true } }), all), null, "a stale reading doesn't suggest");
  assert.equal(suggestContinuation(current, [current, p("codex", 95, 30)]), null, "no target with room");
  assert.equal(JSON.parse(JSON.stringify(suggestContinuation(p("claude", 10, 97), all))).reason, "of the week");
});

test("tab auto-close: only success, closed, seen and after the delay counted from the last time on screen", () => {
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
  assert.deepEqual(run(T0 + 119_000), [], "before the delay nothing closes");
  assert.deepEqual(run(T0 + 121_000), ["ok"], "success closes; error, running, open, unseen output and recently seen stay");
  assert.deepEqual(run(T0 + 221_000), ["ok", "vista-agora"], "the seen tab's delay restarts from the last time on screen");
  assert.deepEqual(run(T0 + 121_000, { selectedId: null }), ["ok", "aberta"]);
  assert.deepEqual(run(T0 + 121_000, { seconds: 30 }).includes("erro"), false, "an error never closes on its own");
  assert.deepEqual(JSON.parse(JSON.stringify(tabsToAutoClose(tabs, {}, { now: T0 + 999_999, seconds: 1, selectedId: null, seenSizes }))), [], "without a clock (not observed yet) it doesn't close");
});

test("permission mode by shortcut: cycle, plan on/off and only Alt+P/Alt+M count", () => {
  const { nextPermission, togglePlan, permissionShortcut, PERMISSION_CYCLE } = loadTs("src/lib/permissionModes.ts");
  assert.deepEqual(JSON.parse(JSON.stringify(PERMISSION_CYCLE)), ["inherit", "plan", "ask", "edits", "full"]);
  assert.equal(nextPermission("inherit"), "plan");
  assert.equal(nextPermission("edits"), "full");
  assert.equal(nextPermission("full"), "inherit", "after the last one it goes back to the first");
  assert.equal(nextPermission(undefined), "plan", "without a set mode it counts as the CLI's");
  assert.equal(togglePlan("edits"), "plan");
  assert.equal(togglePlan("plan"), "edits");
  assert.equal(togglePlan("full"), "plan");
  const { withPermission, permissionAfterPlan } = loadTs("src/lib/permissionModes.ts");
  for (const permission of ["inherit", "ask", "edits", "full"]) {
    const plan = withPermission({ permission }, "plan");
    assert.equal(plan.permission, "plan");
    assert.equal(plan.permissionBeforePlan, permission);
    assert.equal(withPermission(plan, "plan").permissionBeforePlan, permission);
    assert.equal(permissionAfterPlan(plan), permission);
    assert.equal(togglePlan("plan", permission), permission);
    assert.equal(withPermission(plan, permission).permissionBeforePlan, undefined);
  }
  const key = (k, extra = {}) => ({ key: k, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });
  assert.equal(permissionShortcut(key("p")), "plan");
  assert.equal(permissionShortcut(key("M")), "cycle");
  assert.equal(permissionShortcut(key("p", { altKey: false })), null, "without Alt it isn't a shortcut");
  assert.equal(permissionShortcut(key("p", { ctrlKey: true })), null);
  assert.equal(permissionShortcut(key("p", { shiftKey: true })), null);
  assert.equal(permissionShortcut(key("x")), null);
});

test("permission change notice during the reply: live, on the next message and approvals released", () => {
  const { livePermissionNotice } = loadTs("src/lib/permissionModes.ts");
  assert.equal(livePermissionNotice({ ok: true, applied: "now", approved: 0 }, true), "New level applied to the reply in progress.");
  assert.match(livePermissionNotice({ ok: true, applied: "next", approved: 0 }, true), /next message/);
  assert.match(livePermissionNotice({ ok: true, applied: "now", approved: 2 }, true), /2 pending approvals were released/);
  assert.equal(livePermissionNotice({ ok: true, applied: "next", approved: 0 }, false), null, "stopped: nothing to explain");
  assert.equal(livePermissionNotice({ ok: true, applied: "now", approved: 1 }, false), "1 pending approval was released.");
  assert.equal(livePermissionNotice({ ok: false }, true), null);
});

test("approve-plan button: only in plan mode, stopped, after a finished AI reply", () => {
  const { canApprovePlan, planApprovedPrompt } = loadTs("src/lib/permissionModes.ts");
  const plan = { sender: "codex", text: "## Plano\n1. Criar hello.txt\n\nPosso começar?" };
  for (const provider of ["claude", "codex", "antigravity"])
    assert.equal(canApprovePlan("plan", false, { ...plan, sender: provider }), true, provider);
  assert.equal(canApprovePlan("edits", false, plan), false, "outside plan mode");
  assert.equal(canApprovePlan("ask", false, plan), false, "Restricted isn't plan mode");
  assert.equal(canApprovePlan("plan", true, plan), false, "with a reply in progress");
  assert.equal(canApprovePlan("plan", false, { ...plan, isStreaming: true }), false);
  assert.equal(canApprovePlan("plan", false, { sender: "user", text: "faz um plano" }), false);
  assert.equal(canApprovePlan("plan", false, { sender: "claude", text: "  " }), false, "empty reply");
  assert.equal(canApprovePlan("plan", false, undefined), false, "empty conversation");
  assert.match(planApprovedPrompt(), /Plan approved/);
});
