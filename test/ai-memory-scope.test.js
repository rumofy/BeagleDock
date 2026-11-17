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

test("marker in the cwd itself", async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, ".ai-memory.toml"), '# c\nworkspace = "rumofy"\nproject = "rumofy-next" # x\n');
  const r = await resolveAiMemoryScope(d);
  assert.deepEqual(r, { workspace: "rumofy", project: "rumofy-next", source: "marker", markerPath: path.join(d, ".ai-memory.toml") });
});

test("marker in an ancestor directory", async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, ".ai-memory.toml"), 'workspace = "w"\nproject = "p"\n');
  const sub = path.join(d, "a", "b");
  fs.mkdirSync(sub, { recursive: true });
  const r = await resolveAiMemoryScope(sub);
  assert.equal(r.project, "p");
  assert.equal(r.markerPath, path.join(d, ".ai-memory.toml"));
});

test("a marker without project uses the git remote (upstream before origin)", async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, ".ai-memory.toml"), 'workspace = "rumofy"\n');
  gitRepo(d, { origin: "git@github-rumofy:rumofy/BeagleDock.git", upstream: "https://github.com/acme/api.git" });
  const r = await resolveAiMemoryScope(d);
  assert.equal(r.workspace, "rumofy");
  assert.equal(r.project, "acme-api");
  assert.equal(r.source, "git");
  assert.ok(r.markerPath);
});

test("no marker, with a remote", async () => {
  const d = tmp();
  gitRepo(d, { origin: "git@github-rumofy:rumofy/BeagleDock.git" });
  const r = await resolveAiMemoryScope(d);
  assert.deepEqual(
    { w: r.workspace, p: r.project, s: r.source, m: r.markerPath },
    { w: "default", p: "rumofy-BeagleDock", s: "git", m: null },
  );
});

test("no marker and no remote uses the folder name", async () => {
  const d = path.join(tmp(), "minha-pasta");
  fs.mkdirSync(d);
  gitRepo(d);
  const r = await resolveAiMemoryScope(d);
  assert.equal(r.project, "minha-pasta");
  assert.equal(r.source, "folder");
});

test("URL normalization", () => {
  assert.equal(projectFromRemote("ssh://git@host:22/a/b/c.git"), "a-b-c");
  assert.equal(projectFromRemote("https://github.com/acme/api"), "acme-api");
  assert.equal(projectFromRemote(""), "");
});

const { writeMarkerScope, clearMarkerScope, markerIsLocal } = require("../electron/ai-memory-scope");

test("linking writes workspace/project and keeps the marker's other lines", async () => {
  const d = tmp();
  const file = path.join(d, ".ai-memory.toml");
  fs.writeFileSync(file, '# note\nproject = "old"\nserver = "vps"\n\n[auto_scope]\nproject = "kept"\n');
  writeMarkerScope(d, { workspace: "default", project: "CapyAI" });
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^workspace = "default"\nproject = "CapyAI"\n# note\nserver = "vps"\n\n\[auto_scope\]\nproject = "kept"\n$/);
  const r = await resolveAiMemoryScope(d);
  assert.deepEqual({ w: r.workspace, p: r.project, s: r.source }, { w: "default", p: "CapyAI", s: "marker" });
  assert.equal(markerIsLocal(r.markerPath, d), true);
});

test("linking creates the marker and refuses names that would break the TOML", () => {
  const d = tmp();
  writeMarkerScope(d, { workspace: "rumofy", project: "rumofy-next" });
  assert.equal(fs.readFileSync(path.join(d, ".ai-memory.toml"), "utf8"), 'workspace = "rumofy"\nproject = "rumofy-next"\n');
  assert.throws(() => writeMarkerScope(d, { workspace: "x", project: 'a"\nserver = "evil' }), /invalid/);
  assert.throws(() => writeMarkerScope(d, { workspace: "", project: "p" }), /invalid/);
});

test("removing the link deletes a marker left empty and keeps one with other settings", () => {
  const d = tmp();
  const file = path.join(d, ".ai-memory.toml");
  writeMarkerScope(d, { workspace: "w", project: "p" });
  assert.equal(clearMarkerScope(d), true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(clearMarkerScope(d), false);
  fs.writeFileSync(file, 'workspace = "w"\nproject = "p"\nserver = "vps"\n');
  clearMarkerScope(d);
  assert.equal(fs.readFileSync(file, "utf8"), 'server = "vps"\n');
});

test("a marker in a parent folder is not local", () => {
  const d = tmp();
  const sub = path.join(d, "sub");
  fs.mkdirSync(sub);
  assert.equal(markerIsLocal(path.join(d, ".ai-memory.toml"), sub), false);
  assert.equal(markerIsLocal(null, sub), false);
});
