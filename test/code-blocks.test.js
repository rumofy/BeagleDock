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

test("texto sem cerca fica intacto", () => {
  assert.deepEqual(plain(splitMessage("só texto\ncom linhas")), [{ type: "text", value: "só texto\ncom linhas" }]);
  assert.deepEqual(plain(splitMessage("")), [{ type: "text", value: "" }]);
});

test("separa texto e blocos com linguagem, preservando o conteúdo", () => {
  const input = "Rode isto:\n```bash\nnpm test\nnpm run build\n```\nDepois:\n```ts\nconst a = 1;\n```\nFim";
  const parts = plain(splitMessage(input));
  assert.deepEqual(parts.map((p) => p.type), ["text", "code", "text", "code", "text"]);
  assert.equal(parts[1].lang, "bash");
  assert.equal(parts[1].code, "npm test\nnpm run build");
  assert.equal(parts[1].closed, true);
  assert.equal(parts[3].code, "const a = 1;");
  assert.equal(parts[4].value, "Fim");
});

test("bloco ainda aberto durante o streaming aparece como código não fechado", () => {
  const parts = plain(splitMessage("Veja:\n```python\nprint('oi')\nfor x in"));
  assert.equal(parts[1].closed, false);
  assert.equal(parts[1].lang, "python");
  assert.equal(parts[1].code, "print('oi')\nfor x in");
  // a cerca de abertura sozinha também já é um bloco
  assert.equal(plain(splitMessage("```"))[0].type, "code");
});

test("crases dentro do código e cercas com mais texto não quebram o bloco", () => {
  const parts = plain(splitMessage("```md\nuse `npm test` aqui\n```"));
  assert.equal(parts[0].code, "use `npm test` aqui");
  const nested = plain(splitMessage("```js\nconst s = `a${b}`;\n```\nok"));
  assert.equal(nested[0].code, "const s = `a${b}`;");
  assert.equal(nested[1].value, "ok");
});

test("destaque: palavras-chave, textos, números, comentários e funções", () => {
  const t = types(tokenize("const x = foo('a', 42); // fim", "ts"));
  assert.ok(t.includes("keyword:const"));
  assert.ok(t.includes("function:foo"));
  assert.ok(t.includes("string:'a'"));
  assert.ok(t.includes("number:42"));
  assert.ok(t.some((s) => s.startsWith("comment:// fim")));
});

test("destaque: shell, python e SQL usam os comentários e as palavras-chave da família", () => {
  assert.ok(types(tokenize("echo oi # comentário", "bash")).some((s) => s.startsWith("comment:# comentário")));
  assert.ok(types(tokenize("def f(x):\n  return None", "python")).includes("keyword:def"));
  assert.ok(types(tokenize("SELECT id FROM t -- nota", "sql")).includes("keyword:SELECT"));
  assert.ok(types(tokenize("// não é comentário em json", "json")).every((s) => !s.startsWith("comment:")));
});

test("JSON destaca chaves como propriedades e valores como texto", () => {
  const t = types(tokenize('{"nome": "Stella", "idade": 3}', "json"));
  assert.ok(t.includes('property:"nome"'));
  assert.ok(t.includes('string:"Stella"'));
  assert.ok(t.includes("number:3"));
});

test("diff colore linhas adicionadas, removidas e cabeçalhos", () => {
  const t = types(tokenize("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-velho\n+novo\n igual", "diff"));
  assert.deepEqual(t.map((s) => s.split(":")[0]), ["meta", "meta", "keyword", "del", "add", "plain"]);
});

test("o destaque nunca perde nem altera texto", () => {
  const samples = ['const s = "a\\"b" + `x${y}`; /* c */', "x = 'não fechado", "<div class=\"a\">&amp;</div>", "a\tb  c\n\nd", "0xFF 1e10 3.14 _x $y"];
  for (const code of samples) for (const lang of ["ts", "python", "json", "sql", "html", "", "diff"])
    assert.equal(plain(tokenize(code, lang)).map((t) => t.text).join(""), code, `${lang}: ${code}`);
});
