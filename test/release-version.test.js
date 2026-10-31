const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");
const load = () => import(pathToFileURL(path.join(root, "scripts", "release-version.mjs")).href);
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const SAMPLE = `# Changelog

Intro.

## [Unreleased]

### Adicionado

- Algo novo.

### Corrigido

- Um erro.

## [0.1.1] - 2026-10-31

### Adicionado

- Antigo.

[Unreleased]: https://github.com/x/y/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/x/y/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/x/y/releases/tag/v0.1.0
`;

test("releaseChangelog move entradas, mantém ordem e atualiza links", async () => {
  const { releaseChangelog } = await load();
  const out = releaseChangelog(SAMPLE, "0.2.0", "2026-11-01");
  const iU = out.indexOf("## [Unreleased]");
  const iN = out.indexOf("## [0.2.0] - 2026-11-01");
  const iO = out.indexOf("## [0.1.1] - 2026-10-31");
  assert.ok(iU > 0 && iU < iN && iN < iO);
  assert.equal(out.slice(iU, iN).trim(), "## [Unreleased]");
  const novo = out.slice(iN, iO);
  assert.match(novo, /### Adicionado\n\n- Algo novo\./);
  assert.ok(novo.indexOf("### Adicionado") < novo.indexOf("### Corrigido"));
  assert.match(out, /^\[Unreleased\]: https:\/\/github.com\/x\/y\/compare\/v0\.2\.0\.\.\.HEAD$/m);
  assert.match(out, /^\[0\.2\.0\]: https:\/\/github.com\/x\/y\/compare\/v0\.1\.1\.\.\.v0\.2\.0$/m);
  assert.match(out, /^\[0\.1\.1\]: .*v0\.1\.0\.\.\.v0\.1\.1$/m);
  assert.ok(out.indexOf("[0.2.0]:") < out.indexOf("[0.1.1]:"));
  assert.ok(out.endsWith("\n"));
});

test("releaseChangelog recusa Unreleased sem entradas", async () => {
  const { releaseChangelog } = await load();
  const vazio = SAMPLE.replace(/## \[Unreleased\][\s\S]*?(?=## \[0\.1\.1\])/, "## [Unreleased]\n\n");
  assert.throws(() => releaseChangelog(vazio, "0.2.0", "2026-11-01"), /sem entradas/);
  assert.throws(() => releaseChangelog("# x\n", "0.2.0", "2026-11-01"), /Unreleased/);
});

test("syncOpenapi atualiza info.version", async () => {
  const { syncOpenapi } = await load();
  const out = JSON.parse(syncOpenapi(JSON.stringify({ info: { title: "t", version: "0.0.1" }, paths: {} }), "1.2.3"));
  assert.equal(out.info.version, "1.2.3");
  assert.equal(out.info.title, "t");
  assert.deepEqual(out.paths, {});
});

test("consistência: versão única em package.json, openapi, CHANGELOG e README", () => {
  const version = JSON.parse(read("package.json")).version;
  assert.equal(JSON.parse(read("docs/openapi.json")).info.version, version);

  const cl = read("CHANGELOG.md");
  assert.match(cl, /^## \[Unreleased\]$/m);
  const released = [...cl.matchAll(/^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/gm)].map((m) => m[1]);
  assert.equal(released[0], version);

  const allowed = ["Adicionado", "Alterado", "Descontinuado", "Removido", "Corrigido", "Segurança"];
  for (const m of cl.matchAll(/^### (.+)$/gm)) assert.ok(allowed.includes(m[1].trim()), `Subseção inválida: ${m[1]}`);

  const readme = read("README.md");
  const esc = version.replace(/\./g, "\\.");
  assert.doesNotMatch(readme, new RegExp(`(?<![\\d.])${esc}(?![\\d.])`), "README não deve conter a versão do app");
  assert.doesNotMatch(readme, /BeagleDock[ -]v?\d+\.\d+\.\d+/, "README não deve fixar versão após o nome");
});
