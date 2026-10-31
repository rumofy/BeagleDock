const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { saveAttachments, findMentions, buildInput, MAX_ATTACHMENTS } = require("../electron/attachments");
const { createCliRunner } = require("../electron/cli-runner");

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "beagledock-attach-")));
const project = path.join(root, "projeto");
fs.mkdirSync(path.join(project, "src"), { recursive: true });
fs.writeFileSync(path.join(project, "src", "app.ts"), "export {}");
fs.writeFileSync(path.join(root, "segredo.txt"), "fora do projeto");
after(() => fs.rmSync(root, { recursive: true, force: true }));

const PNG = "data:image/png;base64," + Buffer.from("PNGDATA").toString("base64");
const TXT = "data:text/plain;base64," + Buffer.from("log de erro").toString("base64");
const att = (name, url) => ({ id: name, name, type: "file", url, sizeText: "1 KB" });

test("anexos: grava na pasta da conversa, sanitiza o nome e separa imagem de arquivo", () => {
  const files = saveAttachments({ sessionId: "s1", attachments: [att("../../etc/passwd", TXT), att("print", PNG)], root: path.join(root, "dados") });
  assert.deepEqual(files.map((f) => [f.kind, f.mime]), [["file", "text/plain"], ["image", "image/png"]]);
  for (const f of files) {
    assert.ok(f.path.startsWith(path.join(root, "dados", "attachments", "s1") + path.sep), "dentro da pasta da conversa");
    assert.ok(fs.existsSync(f.path));
  }
  assert.ok(files[1].path.endsWith(".png"), "imagem sem extensão ganha a do tipo");
  assert.equal(fs.readFileSync(files[0].path, "utf8"), "log de erro");
  assert.equal(fs.statSync(files[0].path).mode & 0o077, 0, "só o dono lê");
});

test("anexos: recusa conteúdo inválido, vazio, grande demais e excesso de arquivos", () => {
  const opts = (attachments) => ({ sessionId: "s2", attachments, root: path.join(root, "dados") });
  assert.throws(() => saveAttachments(opts([att("a", "http://x/a.png")])), /inválido/);
  assert.throws(() => saveAttachments(opts([att("a", "data:text/plain;base64,")])), /vazio/);
  assert.throws(() => saveAttachments(opts([att("a", "data:text/plain;base64," + Buffer.alloc(15 * 1024 * 1024 + 1).toString("base64"))])), /MB/);
  assert.throws(() => saveAttachments(opts(Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => att(`f${i}`, TXT)))), /no máximo/);
  assert.deepEqual(saveAttachments(opts(undefined)), []);
});

test("@arquivo: só vira menção se for arquivo existente dentro do projeto", () => {
  const found = findMentions("veja @src/app.ts, @../segredo.txt, @src, @nada.ts e dev@empresa.com", project);
  assert.deepEqual(found.map((m) => m.name), ["src/app.ts"]);
  assert.equal(found[0].path, path.join(project, "src", "app.ts"));
  assert.deepEqual(findMentions("sem menção", project), []);
});

test("entrada nativa: Claude (imagem base64), Codex (localImage e mention) e Antigravity (texto com aviso)", () => {
  const files = saveAttachments({ sessionId: "s3", attachments: [att("print.png", PNG), att("erro.log", TXT)], root: path.join(root, "dados") });
  const mentions = findMentions("@src/app.ts", project);
  const claude = buildInput("claude", { prompt: "analisa", files, mentions });
  assert.equal(claude.content[0].type, "image");
  assert.deepEqual(claude.content[0].source, { type: "base64", media_type: "image/png", data: Buffer.from("PNGDATA").toString("base64") });
  assert.equal(claude.content[1].type, "text");
  assert.match(claude.content[1].text, /Arquivos anexados:\n- .*erro\.log/);
  assert.doesNotMatch(claude.content[1].text, /print\.png/, "a imagem vai como bloco, não como caminho");
  assert.deepEqual(claude.warnings, []);

  const codex = buildInput("codex", { prompt: "analisa", files, mentions });
  assert.deepEqual(codex.input.map((i) => i.type), ["text", "localImage", "mention", "mention"]);
  assert.equal(codex.input[1].path, files[0].path);
  assert.deepEqual(codex.input.slice(2).map((i) => i.name), ["erro.log", "src/app.ts"]);

  const agy = buildInput("antigravity", { prompt: "analisa", files, mentions });
  assert.equal(typeof agy.text, "string");
  assert.match(agy.text, /print\.png.*\(imagem\)/s);
  assert.equal(agy.warnings.length, 1);
  assert.match(agy.warnings[0], /Antigravity/);
  assert.equal(buildInput("claude", { prompt: "só texto" }).content, "só texto");
  assert.equal(buildInput("antigravity", { prompt: "só texto" }).warnings.length, 0);
});

// Contrato do envio: o runner entrega o que cada CLI espera no protocolo dela.
function harness() {
  const calls = [], emitted = [], links = new Map();
  const spawn = (bin, args) => {
    const child = new EventEmitter();
    Object.assign(child, { pid: 100 + calls.length, exitCode: null, killed: false, stdout: new PassThrough(), stderr: new PassThrough(), inputs: [] });
    child.stdin = new Writable({ write(chunk, enc, done) { child.inputs.push(chunk.toString()); done(); } });
    child.event = (data) => child.stdout.write(JSON.stringify(data) + "\n");
    child.close = (code) => { child.exitCode = code; child.emit("close", code); };
    child.kill = () => { child.killed = true; queueMicrotask(() => child.close(143)); };
    calls.push({ bin, args, child });
    return child;
  };
  const runner = createCliRunner({
    store: { getNativeSession: async (id) => links.get(id), setNativeSession: async (id, p, n, c) => links.set(id, { nativeId: n, cwd: c }) },
    spawn, find: (n) => n, emit: (ch, data) => emitted.push({ ch, data }), checkCwd: (c) => c,
    turnTimeout: 2000, attachmentsRoot: path.join(root, "dados"),
  });
  return { runner, calls, emitted };
}
const tick = () => new Promise((r) => setImmediate(r));
const base = (providerId, extra) => ({ sessionId: `app-${providerId}`, providerId, prompt: "olha isso @src/app.ts", cwd: project, permission: "plan", effort: "medium", model: "", responseMessageId: "r1", ...extra });

test("contrato Claude: a mensagem de usuário leva o bloco de imagem em base64 e o texto com o arquivo", async () => {
  const h = harness();
  const pending = h.runner.execute(base("claude", { attachments: [att("print.png", PNG), att("erro.log", TXT)] }));
  await tick(); await tick();
  const child = h.calls[0].child;
  const sent = child.inputs.map((l) => JSON.parse(l)).find((m) => m.type === "user");
  assert.equal(sent.message.role, "user");
  assert.equal(sent.message.content[0].type, "image");
  assert.equal(sent.message.content[0].source.media_type, "image/png");
  assert.match(sent.message.content.at(-1).text, /olha isso @src\/app\.ts[\s\S]*erro\.log/);
  child.event({ type: "result", session_id: "claude-native-att", result: "ok", is_error: false });
  child.close(0);
  assert.equal((await pending).ok, true);
  assert.equal(h.emitted.filter((e) => e.ch === "cli-notice").length, 0);
});

test("contrato Antigravity: o texto leva os caminhos e a pessoa recebe o aviso sobre imagem", async () => {
  const h = harness();
  const pending = h.runner.execute(base("antigravity", { attachments: [att("print.png", PNG)] }));
  await tick(); await tick();
  const child = h.calls[0].child;
  const sent = child.inputs.map((l) => JSON.parse(l)).find((m) => m.event === "user");
  assert.equal(typeof sent.message.content, "string");
  assert.match(sent.message.content, /print\.png.*\(imagem\)/s);
  const notice = h.emitted.find((e) => e.ch === "cli-notice");
  assert.match(notice.data.message, /Antigravity/);
  assert.equal(notice.data.sessionId, "app-antigravity");
  child.event({ event: "init", conversation_id: "native-att-1" });
  child.event({ event: "result", result: { status: "SUCCESS", response: "ok" } });
  child.close(0);
  await pending;
});

test("anexo inválido falha a execução com erro claro, sem iniciar a CLI", async () => {
  const h = harness();
  const result = await h.runner.execute(base("claude", { attachments: [att("a", "http://x/a.png")] }));
  assert.equal(result.ok, false);
  assert.match(result.error, /Anexo inválido/);
  assert.equal(h.calls.length, 0);
});

const vm = require("node:vm");
const ts = require("typescript");
const loadTs = (file) => {
  const out = ts.transpileModule(fs.readFileSync(path.resolve(file), "utf8").replace(/^import .*$/gm, ""), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ctx = { exports: {}, RegExp, Math };
  vm.runInNewContext(out, ctx);
  return ctx.exports;
};

test("interface: limites do anexo, menção sob o cursor e o que a conversa guarda", () => {
  const lib = loadTs("src/lib/attachments.ts");
  assert.equal(lib.attachmentProblem({ name: "a.png", size: 100 }, 0), null);
  assert.match(lib.attachmentProblem({ name: "a.png", size: 100 }, 10), /no máximo 10/);
  assert.match(lib.attachmentProblem({ name: "vazio", size: 0 }, 0), /vazio/);
  assert.match(lib.attachmentProblem({ name: "grande", size: 16 * 1024 * 1024 }, 0), /15 MB/);
  assert.equal(lib.sizeText(2048), "2 KB");
  assert.equal(lib.sizeText(3 * 1024 * 1024), "3.0 MB");
  assert.deepEqual(JSON.parse(JSON.stringify(lib.mentionAt("veja @src/ap", 12))), { query: "src/ap", start: 5 });
  assert.deepEqual(JSON.parse(JSON.stringify(lib.mentionAt("@", 1))), { query: "", start: 0 });
  assert.equal(lib.mentionAt("dev@empresa.com", 15), null, "e-mail não abre a lista");
  assert.equal(lib.mentionAt("veja @src/app.ts depois", 23), null, "cursor fora do trecho");
  assert.deepEqual(JSON.parse(JSON.stringify(lib.applyMention("veja @sr e mais", 8, 5, "src/app.ts"))), { text: "veja @src/app.ts  e mais", caret: 17 });
  const kept = JSON.parse(JSON.stringify(lib.storableAttachments([
    { id: "1", name: "a.png", type: "image", url: "data:image/png;base64,AAAA", sizeText: "1 KB" },
    { id: "2", name: "grande.png", type: "image", url: "x".repeat(800 * 1024), sizeText: "9 MB" },
    { id: "3", name: "a.log", type: "file", url: "data:text/plain;base64,AAAA", sizeText: "1 KB" },
  ])));
  assert.deepEqual(kept.map((a) => a.url.length > 0), [true, false, false], "só prévia de imagem pequena fica no histórico");
});

test("@arquivo: lista do git, busca por nome e por letras, e percurso sem git ignorando dependências", async () => {
  const { listFiles, searchFiles, walk } = require("../electron/project-files");
  const files = ["src/hooks/useSessions.ts", "src/app.ts", "README.md", "docs/app-guide.md", "test/app.test.js"];
  assert.deepEqual(searchFiles(files, "app").slice(0, 2), ["src/app.ts", "test/app.test.js"], "nome do arquivo antes do caminho");
  assert.equal(searchFiles(files, "uss")[0], "src/hooks/useSessions.ts", "letras na ordem do nome");
  assert.deepEqual(searchFiles(files, "zzz"), []);
  assert.equal(searchFiles(files, "").length, 5);
  assert.equal(searchFiles(files, "", 2).length, 2);
  const viaGit = await listFiles("/p", { find: () => "/usr/bin/git", exec: async (bin, args) => { assert.deepEqual(args.slice(0, 3), ["-C", "/p", "ls-files"]); return { stdout: "a.ts\0b/c.ts\0" }; } });
  assert.deepEqual(viaGit, ["a.ts", "b/c.ts"]);
  const tree = path.join(root, "arvore");
  for (const f of ["src/x.ts", "node_modules/dep/i.js", ".git/config", ".oculta/y", "docs/z.md"]) {
    fs.mkdirSync(path.dirname(path.join(tree, f)), { recursive: true });
    fs.writeFileSync(path.join(tree, f), "");
  }
  assert.deepEqual(walk(tree).sort(), ["docs/z.md", "src/x.ts"]);
  const noGit = await listFiles(tree, { find: () => null });
  assert.deepEqual(noGit.sort(), ["docs/z.md", "src/x.ts"]);
  const failing = await listFiles(tree, { find: () => "git", exec: async () => { throw new Error("not a git repository"); } });
  assert.deepEqual(failing.sort(), ["docs/z.md", "src/x.ts"], "git falhou: percorre as pastas");
});
