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

test("abre arquivo na linha e coluna dentro do projeto, sem shell", async () => {
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

test("abrir o projeto manda a pasta inteira", async () => {
  const dir = project();
  const calls = [];
  await openInEditor({ cwd: dir }, { find: () => "/usr/bin/code", spawn: fakeSpawn(calls) });
  assert.deepEqual(calls[0].args, [dir]);
});

test("caminhos fora do projeto, inexistentes ou por link simbólico são recusados", async () => {
  const dir = project();
  assert.throws(() => resolveInsideProject(dir, "../../etc/passwd"), /fora do projeto|não encontrado/);
  assert.throws(() => resolveInsideProject(dir, "/etc/passwd"), /fora do projeto/);
  assert.throws(() => resolveInsideProject(dir, "src/nao-existe.ts"), /não encontrado/);
  fs.symlinkSync("/etc", path.join(dir, "escape"));
  assert.throws(() => resolveInsideProject(dir, "escape/passwd"), /fora do projeto/);
});

test("linha inválida é ignorada e a ausência do VS Code gera erro claro", async () => {
  const dir = project();
  const resolved = resolveInsideProject(dir, "src/app.ts");
  assert.deepEqual(buildArgs(resolved, -3, "x"), [dir, "--goto", resolved.real]);
  await assert.rejects(
    openInEditor({ cwd: dir, target: "src/app.ts" }, { find: () => null, spawn: fakeSpawn([]) }),
    /VS Code não encontrado/,
  );
  await assert.rejects(
    openInEditor({ cwd: dir }, { find: () => "/x/code", spawn: fakeSpawn([], true) }),
    /ENOENT/,
  );
});

// Alvo moderno, como o build do app: em ES5 o for…of sobre matchAll não itera.
const compiled = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/fileLinks.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ctx = { exports: {}, RegExp, Number };
vm.runInNewContext(compiled, ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));
const split = (t) => plain(ctx.exports.splitFileLinks(t));

test("links: arquivo com linha e coluna, relativo e absoluto", () => {
  const parts = split("Veja src/hooks/useSessions.ts:613 e ./a/b.test.js:4:9, depois /home/x/p/main.go.");
  const files = parts.filter((p) => p.type === "file");
  assert.deepEqual(files.map((f) => [f.path, f.line, f.column]), [
    ["src/hooks/useSessions.ts", 613, undefined],
    ["./a/b.test.js", 4, 9],
    ["/home/x/p/main.go", undefined, undefined],
  ]);
  assert.equal(parts.map((p) => p.value).join(""), "Veja src/hooks/useSessions.ts:613 e ./a/b.test.js:4:9, depois /home/x/p/main.go.");
});

test("links: não captura URLs, e-mails, domínios nem versões", () => {
  for (const text of [
    "https://github.com/acme/api/blob/main/src/app.ts",
    "fale com dev@empresa.com.br",
    "acesse example.com/login",
    "usa node.js v18.2 e react 19.2",
    "arquivo.exe e foo.bar",
  ])
    assert.equal(split(text).filter((p) => p.type === "file").length, 0, text);
});

test("links: nome com linha sem diretório conta; sem linha e sem barra não", () => {
  assert.deepEqual(split("erro em app.ts:12").filter((p) => p.type === "file").map((f) => f.line), [12]);
  assert.equal(split("o arquivo README.md existe").filter((p) => p.type === "file").length, 1);
  assert.deepEqual(split("sem nada"), [{ type: "text", value: "sem nada" }]);
});
