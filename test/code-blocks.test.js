const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript");
function load(file) {
  const out = ts.transpileModule(fs.readFileSync(path.resolve(file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const ctx = { exports: {}, RegExp, Set, Math, Number };
  vm.runInNewContext(out, ctx);
  return ctx.exports;
}
const { splitMessage } = load("src/lib/codeBlocks.ts");
const { tokenize } = load("src/lib/highlight.ts");
const plain = (v) => JSON.parse(JSON.stringify(v));
const types = (tokens) => plain(tokens).map((t) => `${t.type}:${t.text}`);

test("text without a fence stays intact", () => {
  assert.deepEqual(plain(splitMessage("só texto\ncom linhas")), [{ type: "text", value: "só texto\ncom linhas" }]);
  assert.deepEqual(plain(splitMessage("")), [{ type: "text", value: "" }]);
});

test("splits text and blocks with a language, preserving the content", () => {
  const input = "Rode isto:\n```bash\nnpm test\nnpm run build\n```\nDepois:\n```ts\nconst a = 1;\n```\nFim";
  const parts = plain(splitMessage(input));
  assert.deepEqual(parts.map((p) => p.type), ["text", "code", "text", "code", "text"]);
  assert.equal(parts[1].lang, "bash");
  assert.equal(parts[1].code, "npm test\nnpm run build");
  assert.equal(parts[1].closed, true);
  assert.equal(parts[3].code, "const a = 1;");
  assert.equal(parts[4].value, "Fim");
});

test("a block still open during streaming shows up as unclosed code", () => {
  const parts = plain(splitMessage("Veja:\n```python\nprint('oi')\nfor x in"));
  assert.equal(parts[1].closed, false);
  assert.equal(parts[1].lang, "python");
  assert.equal(parts[1].code, "print('oi')\nfor x in");
  // the opening fence alone is already a block
  assert.equal(plain(splitMessage("```"))[0].type, "code");
});

test("backticks inside the code and fences with more text don't break the block", () => {
  const parts = plain(splitMessage("```md\nuse `npm test` aqui\n```"));
  assert.equal(parts[0].code, "use `npm test` aqui");
  const nested = plain(splitMessage("```js\nconst s = `a${b}`;\n```\nok"));
  assert.equal(nested[0].code, "const s = `a${b}`;");
  assert.equal(nested[1].value, "ok");
});

test("highlighting: keywords, strings, numbers, comments and functions", () => {
  const t = types(tokenize("const x = foo('a', 42); // fim", "ts"));
  assert.ok(t.includes("keyword:const"));
  assert.ok(t.includes("function:foo"));
  assert.ok(t.includes("string:'a'"));
  assert.ok(t.includes("number:42"));
  assert.ok(t.some((s) => s.startsWith("comment:// fim")));
});

test("highlighting: shell, python and SQL use the family's comments and keywords", () => {
  assert.ok(types(tokenize("echo oi # comentário", "bash")).some((s) => s.startsWith("comment:# comentário")));
  assert.ok(types(tokenize("def f(x):\n  return None", "python")).includes("keyword:def"));
  assert.ok(types(tokenize("SELECT id FROM t -- nota", "sql")).includes("keyword:SELECT"));
  assert.ok(types(tokenize("// não é comentário em json", "json")).every((s) => !s.startsWith("comment:")));
});

test("JSON highlights keys as properties and values as strings", () => {
  const t = types(tokenize('{"nome": "Stella", "idade": 3}', "json"));
  assert.ok(t.includes('property:"nome"'));
  assert.ok(t.includes('string:"Stella"'));
  assert.ok(t.includes("number:3"));
});

test("diff colors added lines, removed lines and headers", () => {
  const t = types(tokenize("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-velho\n+novo\n igual", "diff"));
  assert.deepEqual(t.map((s) => s.split(":")[0]), ["meta", "meta", "keyword", "del", "add", "plain"]);
});

test("highlighting never loses or changes text", () => {
  const samples = ['const s = "a\\"b" + `x${y}`; /* c */', "x = 'não fechado", "<div class=\"a\">&amp;</div>", "a\tb  c\n\nd", "0xFF 1e10 3.14 _x $y"];
  for (const code of samples) for (const lang of ["ts", "python", "json", "sql", "html", "", "diff"])
    assert.equal(plain(tokenize(code, lang)).map((t) => t.text).join(""), code, `${lang}: ${code}`);
});
