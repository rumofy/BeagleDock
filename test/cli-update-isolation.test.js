// Updating one CLI must not take down the conversations of the others, and every stop is logged
// with its reason (an exit without one is a CLI that died on its own).
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-update-")));
process.env.BEAGLEDOCK_DATA_DIR = path.join(root, "data");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const { createCliRunner } = require("../electron/cli-runner");
const { createEventLog, eventLogFile } = require("../electron/event-log");

function harness() {
  const calls = [], links = new Map();
  const spawn = (bin, args) => {
    const child = new EventEmitter();
    Object.assign(child, { pid: 200 + calls.length, exitCode: null, killed: false, stdout: new PassThrough(), stderr: new PassThrough() });
    child.stdin = new Writable({ write(chunk, enc, done) { done(); } });
    child.event = (data) => child.stdout.write(JSON.stringify(data) + "\n");
    child.close = (code) => { child.exitCode = code; child.emit("close", code, null); };
    child.kill = () => { child.killed = true; queueMicrotask(() => child.close(143)); };
    calls.push({ bin, child });
    return child;
  };
  const runner = createCliRunner({
    store: { getNativeSession: async (id) => links.get(id), setNativeSession: async (id, p, n, c) => links.set(id, { nativeId: n, cwd: c }) },
    spawn, find: (n) => n, emit: () => {}, checkCwd: (c) => c, turnTimeout: 2000,
    attachmentsRoot: path.join(root, "attachments"),
  });
  return { runner, calls };
}
const tick = () => new Promise((r) => setImmediate(r));
const run = (providerId) => ({ sessionId: `s-${providerId}`, providerId, prompt: "oi", cwd: root, permission: "plan", effort: "", model: "", responseMessageId: `r-${providerId}` });
const events = () =>
  fs.readFileSync(eventLogFile(), "utf8").trim().split("\n").map((line) => JSON.parse(line));

async function idleConversations(h) {
  const claude = h.runner.execute(run("claude"));
  const agy = h.runner.execute(run("antigravity"));
  await tick(); await tick();
  const claudeChild = h.calls.find((c) => c.bin === "claude").child;
  const agyChild = h.calls.find((c) => c.bin === "agy").child;
  claudeChild.event({ type: "result", session_id: "claude-native-upd", result: "ok", is_error: false });
  agyChild.event({ event: "init", conversation_id: "agy-native-upd" });
  agyChild.event({ event: "result", result: { status: "SUCCESS", response: "ok" } });
  assert.equal((await claude).ok, true);
  assert.equal((await agy).ok, true);
  return { claudeChild, agyChild };
}

test("updating Antigravity closes only its processes; the idle Claude conversation keeps running", async () => {
  const h = harness();
  const { claudeChild, agyChild } = await idleConversations(h);
  assert.equal(h.runner.hasLive("claude"), true);
  assert.equal(h.runner.hasLive("antigravity"), true);
  await h.runner.prepareUpdate("antigravity");
  assert.equal(agyChild.killed, true);
  assert.equal(claudeChild.killed, false, "the other CLI's process is not touched");
  assert.equal(h.runner.hasLive("antigravity"), false);
  assert.equal(h.runner.hasLive("claude"), true);
  const kill = events().find((e) => e.event === "cli.kill" && e.sessionId === "s-antigravity");
  assert.equal(kill.reason, "cli-update");
  const exit = events().find((e) => e.event === "cli.exit" && e.sessionId === "s-antigravity");
  assert.equal(exit.reason, "cli-update");
  h.runner.shutdown();
});

test("a CLI that exits on its own is logged as unexpected, with its code and the end of stderr", async () => {
  const h = harness();
  const { claudeChild } = await idleConversations(h);
  claudeChild.stderr.write("fatal: something broke\n");
  await tick();
  claudeChild.close(1);
  const exit = events().filter((e) => e.event === "cli.exit" && e.sessionId === "s-claude").at(-1);
  assert.equal(exit.reason, "unexpected");
  assert.equal(exit.code, 1);
  assert.equal(exit.providerId, "claude");
  assert.match(exit.stderr, /something broke/);
  h.runner.shutdown();
  const shutdown = events().filter((e) => e.event === "cli.kill" && e.sessionId === "s-antigravity").at(-1);
  assert.equal(shutdown.reason, "app-shutdown");
});

test("event log: masks secrets, truncates long text and rotates past the size limit", () => {
  const file = path.join(root, "rotate", "events.jsonl");
  const log = createEventLog({ file, maxBytes: 400, now: () => new Date("2026-11-20T00:00:00Z") });
  log.log("x", { error: "token=abc123secret", long: "a".repeat(2000), skip: undefined });
  const [first] = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(first.event, "x");
  assert.equal(first.at, "2026-11-20T00:00:00.000Z");
  assert.doesNotMatch(first.error, /abc123secret/);
  assert.ok(first.long.length <= 501);
  assert.equal("skip" in first, false);
  log.log("y");
  assert.ok(fs.existsSync(path.join(root, "rotate", "events.1.jsonl")), "the full file was rotated");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8").trim()).event, "y");
});

// The incident: a Claude turn ended while its background agent kept working; the automatic update
// of another CLI closed the process and the agent died with it.
test("a Claude conversation with a background agent counts as running work until the agent ends", async () => {
  const h = harness();
  const pending = h.runner.execute(run("claude"));
  await tick(); await tick();
  const child = h.calls[0].child;
  const AGENT = "toolu_bg_update";
  child.event({ type: "system", subtype: "init", session_id: "claude-native-bg" });
  child.event({ type: "assistant", message: { model: "m", content: [{ type: "tool_use", id: AGENT, name: "Agent", input: { description: "upscale", subagent_type: "general-purpose", prompt: "x", run_in_background: true } }] } });
  child.event({ type: "user", message: { content: [{ tool_use_id: AGENT, type: "tool_result", content: "Async agent launched successfully." }] } });
  child.event({ type: "result", session_id: "claude-native-bg", result: "rodando", is_error: false });
  assert.equal((await pending).ok, true);
  assert.equal(h.runner.isBusyProvider("claude"), false, "the turn is over");
  assert.equal(h.runner.hasRunningWork("claude"), true, "but its background agent is still working");
  assert.equal(h.runner.hasRunningWork("antigravity"), false);
  child.event({ type: "system", subtype: "task_notification", task_id: "tk", tool_use_id: AGENT, status: "completed", summary: "ok" });
  await tick();
  assert.equal(h.runner.hasRunningWork("claude"), false);
  h.runner.shutdown();
});

test("a run of the CLI being updated waits for the update instead of starting the old binary", async () => {
  const h = harness();
  await h.runner.prepareUpdate("claude");
  const pending = h.runner.execute(run("claude"));
  await tick(); await tick();
  assert.equal(h.calls.length, 0, "no process while the binary is replaced");
  await assert.rejects(h.runner.prepareUpdate("claude"), /wait|Wait/i, "a second update waits for that run");
  h.runner.endUpdate("claude");
  await tick(); await tick(); await tick();
  assert.equal(h.calls.length, 1);
  h.calls[0].child.event({ type: "result", session_id: "claude-native-gate", result: "ok", is_error: false });
  assert.equal((await pending).ok, true);
  h.runner.shutdown();
});
