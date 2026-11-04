const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), vm = require("node:vm");
const { EventEmitter } = require("node:events");
const ts = require("typescript");
const { openInEditor, resolveInsideProject, buildArgs } = require("../electron/editor");

const project = () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-editor-")));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "app.ts"), "x");
  return dir;
};
const fakeSpawn = (calls, fail) => (bin, args, options) => {
  const child = new EventEmitter();
  child.unref = () => {};
  calls.push({ bin, args, options });
  queueMicrotask(() => (fail ? child.emit("error", new Error("ENOENT")) : child.emit("spawn")));
  return child;
};

test("opens a file at the line and column inside the project, without a shell", async () => {
  const dir = project();
  const calls = [];
  const result = await openInEditor(
    { cwd: dir, target: "src/app.ts", line: 42, column: 7 },
    { find: (n) => (n === "code" ? "/usr/bin/code" : null), spawn: fakeSpawn(calls) },
  );
  assert.deepEqual(result, { ok: true, editor: "code" });
  assert.deepEqual(calls[0].args, [dir, "--goto", `${path.join(dir, "src/app.ts")}:42:7`]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.detached, true);
});

test("opening the project sends the whole folder", async () => {
  const dir = project();
  const calls = [];
  await openInEditor({ cwd: dir }, { find: () => "/usr/bin/code", spawn: fakeSpawn(calls) });
  assert.deepEqual(calls[0].args, [dir]);
});

test("paths outside the project, missing or through a symbolic link are refused", async () => {
  const dir = project();
  assert.throws(() => resolveInsideProject(dir, "../../etc/passwd"), /outside this conversation|not found/);
  assert.throws(() => resolveInsideProject(dir, "/etc/passwd"), /outside this conversation/);
  assert.throws(() => resolveInsideProject(dir, "src/nao-existe.ts"), /not found/);
  fs.symlinkSync("/etc", path.join(dir, "escape"));
  assert.throws(() => resolveInsideProject(dir, "escape/passwd"), /outside this conversation/);
});

test("an invalid line is ignored and a missing VS Code gives a clear error", async () => {
  const dir = project();
  const resolved = resolveInsideProject(dir, "src/app.ts");
  assert.deepEqual(buildArgs(resolved, -3, "x"), [dir, "--goto", resolved.real]);
  await assert.rejects(
    openInEditor({ cwd: dir, target: "src/app.ts" }, { find: () => null, spawn: fakeSpawn([]) }),
    /VS Code not found/,
  );
  await assert.rejects(
    openInEditor({ cwd: dir }, { find: () => "/x/code", spawn: fakeSpawn([], true) }),
    /ENOENT/,
  );
});

// Modern target, like the app's build: in ES5 for…of over matchAll doesn't iterate.
const compiled = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/fileLinks.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ctx = { exports: {}, RegExp, Number };
vm.runInNewContext(compiled, ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));
const split = (t) => plain(ctx.exports.splitFileLinks(t));

test("links: file with line and column, relative and absolute", () => {
  const parts = split("Veja src/hooks/useSessions.ts:613 e ./a/b.test.js:4:9, depois /home/x/p/main.go.");
  const files = parts.filter((p) => p.type === "file");
  assert.deepEqual(files.map((f) => [f.path, f.line, f.column]), [
    ["src/hooks/useSessions.ts", 613, undefined],
    ["./a/b.test.js", 4, 9],
    ["/home/x/p/main.go", undefined, undefined],
  ]);
  assert.equal(parts.map((p) => p.value).join(""), "Veja src/hooks/useSessions.ts:613 e ./a/b.test.js:4:9, depois /home/x/p/main.go.");
});

test("links: doesn't capture URLs, e-mails, domains or versions", () => {
  for (const text of [
    "https://github.com/acme/api/blob/main/src/app.ts",
    "fale com dev@empresa.com.br",
    "acesse example.com/login",
    "usa node.js v18.2 e react 19.2",
    "arquivo.exe e foo.bar",
  ])
    assert.equal(split(text).filter((p) => p.type === "file").length, 0, text);
});

test("links: a name with a line and no directory counts; no line and no slash doesn't", () => {
  assert.deepEqual(split("erro em app.ts:12").filter((p) => p.type === "file").map((f) => f.line), [12]);
  assert.equal(split("o arquivo README.md existe").filter((p) => p.type === "file").length, 1);
  assert.deepEqual(split("sem nada"), [{ type: "text", value: "sem nada" }]);
});

test("web links: http(s) become links without the final punctuation and without becoming files", () => {
  const text = "Veja (https://github.com/acme/api/blob/main/src/app.ts), ou https://pt.wikipedia.org/wiki/Foo_(bar). Fim: http://localhost:5173/x?a=1&b=2!";
  const parts = split(text);
  assert.deepEqual(parts.filter((p) => p.type === "url").map((p) => p.url), [
    "https://github.com/acme/api/blob/main/src/app.ts",
    "https://pt.wikipedia.org/wiki/Foo_(bar)",
    "http://localhost:5173/x?a=1&b=2",
  ]);
  assert.equal(parts.filter((p) => p.type === "file").length, 0);
  assert.equal(parts.map((p) => p.value).join(""), text, "no character is lost");
});

test("web links: file and address in the same text; a scheme without a host is ignored", () => {
  const parts = split("Abra src/app.ts:3 e https://example.com/docs, não https:// nem ftp://x.com");
  assert.deepEqual(parts.filter((p) => p.type === "file").map((p) => p.path), ["src/app.ts"]);
  assert.deepEqual(parts.filter((p) => p.type === "url").map((p) => p.url), ["https://example.com/docs"]);
});

test("open in the browser: only http(s) without credentials reaches the system", async () => {
  const { openExternalUrl } = require("../electron/external-links");
  const opened = [];
  const shell = { openExternal: async (u) => opened.push(u) };
  assert.deepEqual(await openExternalUrl(" https://example.com/a?b=1 ", shell), { ok: true });
  for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "ftp://x.com", "https://u:p@x.com", "nada", "", null])
    assert.equal((await openExternalUrl(bad, shell)).ok, false, String(bad));
  assert.deepEqual(opened, ["https://example.com/a?b=1"]);
  assert.equal((await openExternalUrl("https://x.com", { openExternal: async () => { throw new Error("sem navegador"); } })).ok, false);
});
