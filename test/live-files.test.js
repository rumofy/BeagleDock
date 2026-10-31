const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"),
  os = require("os"),
  path = require("path");
const { createLiveFiles, liveDirectories } = require("../electron/live-files");
test("AGY: diretório do filho é acompanhado durante o turno sem reler os logs do pai", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-live-child-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const parent = liveDirectories("antigravity", "parent-session", "/project", { home, env: {} });
  const child = liveDirectories("antigravity", "child-session", "/project", { home, env: {} }).map((d) => ({ ...d, conversationId: "child-session" }));
  fs.mkdirSync(parent[0].dir, { recursive: true });
  fs.mkdirSync(child[0].dir, { recursive: true });
  fs.writeFileSync(path.join(parent[0].dir, "task-3.log"), "OLD_PARENT");
  const output = [];
  const watcher = createLiveFiles({ directories: parent, onData: (text, meta) => output.push({ text, meta }), interval: 10000 });
  t.after(() => watcher.stop());
  await watcher.ready;
  await watcher.addDirectories(child);
  fs.writeFileSync(path.join(child[0].dir, "task-3.log"), "CHILD_FIRST\n");
  await watcher.poll();
  assert.equal(output[0].text, "CHILD_FIRST\n");
  assert.equal(output[0].meta.conversationId, "child-session");
  assert.equal(output[0].meta.stepIndex, "3");
  await watcher.addDirectories(child);
  fs.appendFileSync(path.join(child[0].dir, "task-3.log"), "CHILD_LAST\n");
  await watcher.poll();
  assert.equal(output.map((e) => e.text).join(""), "CHILD_FIRST\nCHILD_LAST\n");
});
test("native task files stream growing UTF-8 logs before command completion and exclude old files and symlinks", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-live-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "task-1.log");
  fs.writeFileSync(file, "old content");
  const data = [];
  const watcher = createLiveFiles({
    directories: [{ dir: root, pattern: /^task-\d+\.log$/ }],
    onData: (text, meta) => data.push({ text, meta }),
    interval: 10000,
  });
  t.after(() => watcher.stop());
  await watcher.ready;
  assert.equal(data.length, 0);
  fs.appendFileSync(file, "first while running\n");
  await watcher.poll();
  assert.equal(data.map((d) => d.text).join(""), "first while running\n");
  assert.equal(data[0].meta.stepIndex, "1");
  const accented = Buffer.from("ação");
  fs.appendFileSync(file, accented.subarray(0, 2));
  await watcher.poll();
  fs.appendFileSync(file, accented.subarray(2));
  await watcher.poll();
  assert.equal(data.map((d) => d.text).join(""), "first while running\nação");
  const secret = path.join(root, "secret.txt");
  fs.writeFileSync(secret, "must never appear");
  fs.symlinkSync(secret, path.join(root, "task-2.log"));
  await watcher.poll();
  assert.doesNotMatch(data.map((d) => d.text).join(""), /must never/);
  fs.writeFileSync(file, "reset\n");
  await watcher.poll();
  assert.equal(data.at(-1).text, "reset\n");
  await watcher.stop();
  fs.appendFileSync(file, "later");
  await watcher.poll();
  assert.doesNotMatch(data.map((d) => d.text).join(""), /later/);
});
test("first-run logs can be discovered after the native id arrives, with bounded reads and session-specific roots", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-native-roots-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dirs = liveDirectories(
    "antigravity",
    "native-session-123",
    "/project",
    { home, env: {} },
  );
  fs.mkdirSync(dirs[0].dir, { recursive: true });
  fs.writeFileSync(path.join(dirs[0].dir, "task-9.log"), "early output");
  const output = [];
  const watcher = createLiveFiles({
    directories: dirs,
    baseline: false,
    onData: (t) => output.push(t),
    interval: 10000,
  });
  t.after(() => watcher.stop());
  await watcher.ready;
  assert.deepEqual(output, ["early output"]);
  assert.deepEqual(
    liveDirectories("antigravity", "../../private", "/project", {
      home,
      env: {},
    }),
    [],
  );
  const claude = liveDirectories(
    "claude",
    "native-session-123",
    "/project/dev",
    { home, env: {}, temp: home, uid: 42 },
  );
  assert.ok(
    claude[0].dir.endsWith(
      path.join("claude-42", "-project-dev", "native-session-123", "tasks"),
    ),
  );
});
test("canonical temp roots work through macOS-style system symlinks but session symlinks cannot escape", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-canonical-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const real = path.join(root, "real"),
    alias = path.join(root, "alias");
  fs.mkdirSync(real);
  fs.symlinkSync(real, alias, "dir");
  const dir = path.join(alias, "native-123/tasks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "task-1.log"), "live");
  const chunks = [];
  const watcher = createLiveFiles({
    directories: [{ base: alias, dir, pattern: /\.log$/ }],
    baseline: false,
    interval: 10000,
    onData: (s) => chunks.push(s),
  });
  t.after(() => watcher.stop());
  await watcher.ready;
  assert.deepEqual(chunks, ["live"]);
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "task-2.log"), "private");
  fs.symlinkSync(outside, path.join(alias, "other-native"), "dir");
  const blocked = [];
  const second = createLiveFiles({
    directories: [
      { base: alias, dir: path.join(alias, "other-native"), pattern: /\.log$/ },
    ],
    baseline: false,
    interval: 10000,
    onData: (s) => blocked.push(s),
  });
  t.after(() => second.stop());
  await second.ready;
  assert.deepEqual(blocked, []);
});
