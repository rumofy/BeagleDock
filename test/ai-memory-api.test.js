const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const api = require("../electron/ai-memory-api");

function home(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aimem-"));
  for (const [rel, content] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
  return dir;
}

test("server url resolution order", () => {
  const h = home({
    ".config/ai-memory/env": "FOO=1\nAI_MEMORY_SERVER_URL=http://env-file:1/\n",
    ".config/ai-memory/remote-active": "https://remote.example\n",
  });
  assert.equal(api.resolveServerUrl({ env: { AI_MEMORY_SERVER_URL: "http://e:2" }, home: h }), "http://e:2");
  assert.equal(api.resolveServerUrl({ env: {}, home: h }), "http://env-file:1");
  const h2 = home({ ".config/ai-memory/remote-active": "https://remote.example\n" });
  assert.equal(api.resolveServerUrl({ env: {}, home: h2 }), "https://remote.example");
  const h3 = home({ ".config/ai-memory/env": "AI_MEMORY_SERVER_URL=\n" });
  assert.equal(api.resolveServerUrl({ env: {}, home: h3 }), "http://127.0.0.1:49374");
});

test("token resolution: env, data dir override and default file", () => {
  const h = home({ ".local/share/ai-memory/auth-token": "  file-token \n" });
  assert.equal(api.resolveToken({ env: { AI_MEMORY_AUTH_TOKEN: "env-token" }, home: h }), "env-token");
  assert.equal(api.resolveToken({ env: {}, home: h }), "file-token");
  const d = home({ "auth-token": "custom\n" });
  assert.equal(api.resolveToken({ env: { AI_MEMORY_DATA_DIR: d }, home: h }), "custom");
  assert.equal(api.resolveToken({ env: {}, home: home() }), "");
});

test("input validation for names and page paths", () => {
  assert.equal(api.validName("dronline", "x"), "dronline");
  for (const bad of ["", "a/b", "..", "a b", "x".repeat(121), null, "a?b", "-rf", "--workspace", "-", ".hidden", "."])
    assert.throws(() => api.validName(bad, "x"), undefined, String(bad));
  assert.equal(api.validPagePath("decisions/a.md"), "decisions/a.md");
  for (const bad of ["/a.md", "../a.md", "a/../b.md", "a.txt", "a//b.md", `${"a".repeat(300)}.md`, "a\\b.md", ""])
    assert.throws(() => api.validPagePath(bad), undefined, bad);
});

test("api functions reject invalid scope before any network call", async () => {
  await assert.rejects(api.listPages("../x", "p"));
  await assert.rejects(api.getPage("w", "p", "../etc.md"));
});
