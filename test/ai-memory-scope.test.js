const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { resolveAiMemoryScope, projectFromRemote } = require("../electron/ai-memory-scope");

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "scope-")));
const gitRepo = (dir, remotes = {}) => {
  execFileSync("git", ["init", "-q", dir]);
  for (const [n, u] of Object.entries(remotes))
    execFileSync("git", ["-C", dir, "remote", "add", n, u]);
};

test("marcador no próprio cwd", async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, ".ai-memory.toml"), '# c\nworkspace = "rumofy"\nproject = "rumofy-next" # x\n');
  const r = await resolveAiMemoryScope(d);
  assert.deepEqual(r, { workspace: "rumofy", project: "rumofy-next", source: "marker", markerPath: path.join(d, ".ai-memory.toml") });
});

test("marcador em diretório ancestral", async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, ".ai-memory.toml"), 'workspace = "w"\nproject = "p"\n');
  const sub = path.join(d, "a", "b");
  fs.mkdirSync(sub, { recursive: true });
  const r = await resolveAiMemoryScope(sub);
  assert.equal(r.project, "p");
  assert.equal(r.markerPath, path.join(d, ".ai-memory.toml"));
});

test("marcador sem project usa remoto git (upstream antes de origin)", async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, ".ai-memory.toml"), 'workspace = "rumofy"\n');
  gitRepo(d, { origin: "git@github-rumofy:rumofy/BeagleDock.git", upstream: "https://github.com/acme/api.git" });
  const r = await resolveAiMemoryScope(d);
  assert.equal(r.workspace, "rumofy");
  assert.equal(r.project, "acme-api");
  assert.equal(r.source, "git");
  assert.ok(r.markerPath);
});

test("sem marcador, com remoto", async () => {
  const d = tmp();
  gitRepo(d, { origin: "git@github-rumofy:rumofy/BeagleDock.git" });
  const r = await resolveAiMemoryScope(d);
  assert.deepEqual(
    { w: r.workspace, p: r.project, s: r.source, m: r.markerPath },
    { w: "default", p: "rumofy-BeagleDock", s: "git", m: null },
  );
});

test("sem marcador e sem remoto usa nome da pasta", async () => {
  const d = path.join(tmp(), "minha-pasta");
  fs.mkdirSync(d);
  gitRepo(d);
  const r = await resolveAiMemoryScope(d);
  assert.equal(r.project, "minha-pasta");
  assert.equal(r.source, "folder");
});

test("normalização de URLs", () => {
  assert.equal(projectFromRemote("ssh://git@host:22/a/b/c.git"), "a-b-c");
  assert.equal(projectFromRemote("https://github.com/acme/api"), "acme-api");
  assert.equal(projectFromRemote(""), "");
});
