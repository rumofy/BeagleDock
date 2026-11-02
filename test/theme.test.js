const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript");
const zoom = require("../electron/zoom");

const out = ts.transpileModule(fs.readFileSync(path.resolve("src/lib/theme.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const ctx = { exports: {}, Math, Number };
vm.runInNewContext(out, ctx);
const { resolveTheme, clampZoom } = ctx.exports;

test("tema: claro por padrão, escuro quando pedido e sistema segue a preferência", () => {
  assert.equal(resolveTheme("cream", true), "light");
  assert.equal(resolveTheme(undefined, true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("zoom respeita os limites e valores inválidos voltam a 100%", () => {
  assert.equal(clampZoom(0.2), 0.7);
  assert.equal(clampZoom(9), 1.6);
  assert.equal(clampZoom(1.2345), 1.23);
  assert.equal(clampZoom(NaN), 1);
  assert.equal(zoom.clamp(Infinity), 1);
});

test("atalhos de zoom: Ctrl +, Ctrl -, Ctrl 0; outras teclas passam", () => {
  const key = (k, extra = {}) => ({ type: "keyDown", control: true, key: k, ...extra });
  assert.equal(zoom.zoomForKey(key("="), 1), 1.1);
  assert.equal(zoom.zoomForKey(key("+"), 1.5), 1.6);
  assert.equal(zoom.zoomForKey(key("+"), 1.6), 1.6, "não passa do máximo");
  assert.equal(zoom.zoomForKey(key("-"), 1), 0.9);
  assert.equal(zoom.zoomForKey(key("0"), 1.4), 1);
  assert.equal(zoom.zoomForKey(key("a"), 1), null);
  assert.equal(zoom.zoomForKey({ type: "keyDown", key: "=" }, 1), null, "sem Ctrl não é zoom");
  assert.equal(zoom.zoomForKey(key("=", { type: "keyUp" }), 1), null);
  assert.equal(zoom.zoomForKey(key("=", { alt: true }), 1), null);
});

test("conversão para o escuro segue o padrão VS Code, inverte luminosidade e mantém transparência", async () => {
  const { darkHex } = await import("../scripts/gen-dark-theme.mjs");
  const lum = (hex) => {
    const n = (i) => parseInt(hex.slice(1 + i, 3 + i), 16);
    return (Math.max(n(0), n(2), n(4)) + Math.min(n(0), n(2), n(4))) / 510;
  };
  assert.ok(lum(darkHex("#fcfbfa")) < 0.15, "fundo creme vira quase preto (editor VS Code)");
  assert.ok(lum(darkHex("#1c1b18", "text")) > 0.85, "texto escuro vira claro");
  assert.ok(lum(darkHex("#141416")) < 0.15, "console PTY já escuro permanece escuro no tema escuro");
  assert.ok(lum(darkHex("#1e1e21")) < 0.18, "barra do console PTY permanece escura no tema escuro");
  assert.equal(darkHex("#ffffff80").length, 9, "mantém o canal alfa");
  assert.match(darkHex("#fff"), /^#[0-9a-f]{6}$/);
});

test("o CSS do tema escuro está em dia com as cores usadas no app e segue o padrão VS Code", async () => {
  const { generateDarkCss } = await import("../scripts/gen-dark-theme.mjs");
  const { css, unsupported } = generateDarkCss();
  const current = fs.readFileSync(path.resolve("src/dark-theme.generated.css"), "utf8");
  assert.equal(current, css, "rode `npm run theme:gen`");
  assert.deepEqual(unsupported, [], "há variantes de cor sem tema escuro");
  assert.match(css, /:root\[data-theme="dark"\] body \{ background: #1e1e1e; color: #d4d4d4; \}/);
  assert.match(css, /:root\[data-theme="dark"\] select option, :root\[data-theme="dark"\] select optgroup \{ background-color: #252526; color: #dbdbdc; \}/);
  assert.match(css, /--color-white: #252526;/);
  assert.match(css, /:root\[data-theme="dark"\] \.hover\\:bg-\\\[\\#/);
});

test("todo texto em hexadecimal do tema escuro tem contraste mínimo de 4,5:1 sobre a superfície mais clara", async () => {
  const { generateDarkCss, contrastRatio, darkHex } = await import("../scripts/gen-dark-theme.mjs");
  const { css } = generateDarkCss();
  const low = [];
  let checked = 0;
  for (const line of css.split("\n")) {
    const match = line.match(/^:root\[data-theme="dark"\] \.(\S+?) \{ color: (#[0-9a-f]{6})/);
    if (!match) continue;
    checked++;
    const ratio = contrastRatio(match[2]);
    if (ratio < 4.5) low.push(`${match[1]} ${match[2]} ${ratio.toFixed(2)}`);
  }
  assert.ok(checked > 10, "o teste precisa encontrar as regras de texto");
  assert.deepEqual(low, []);
});

test("cinza médio do tema claro (#7d7565, #938b7a, #8c8270) fica legível no escuro", async () => {
  const { darkHex, contrastRatio } = await import("../scripts/gen-dark-theme.mjs");
  for (const hex of ["#7d7565", "#938b7a", "#8c8270", "#6d6657", "#9d9483"])
    assert.ok(contrastRatio(darkHex(hex, "text")) >= 4.5, hex);
});

test("texto de paleta nomeada (300–500) e os pares texto/fundo do cartão de permissão ficam legíveis no escuro", async () => {
  const { generateDarkCss, contrastRatio, darkHex } = await import("../scripts/gen-dark-theme.mjs");
  const { css } = generateDarkCss();
  // OKLCH: Y ≈ (L/100)^3; superfície mais clara do escuro (#24211c) tem Y ≈ 0,0154.
  const ratioOklch = (l) => ((l / 100) ** 3 + 0.05) / (0.0154 + 0.05);
  const found = [];
  const low = [];
  for (const line of css.split("\n")) {
    const m = line.match(/^:root\[data-theme="dark"\] \.(text-\S+?) \{ color: oklch\(([\d.]+)%/);
    if (!m) continue;
    found.push(m[1]);
    if (ratioOklch(Number(m[2])) < 4.5) low.push(`${m[1]} L=${m[2]}%`);
  }
  assert.ok(found.length >= 1, "há texto de paleta nomeada com regra própria");
  assert.deepEqual(low, []);
  // Cartão de permissão e badges de cota: texto 800/900 sobre o fundo 50 trocado (950).
  const vars = Object.fromEntries([...css.matchAll(/--color-((?:amber|rose|emerald)-\d+): oklch\(([\d.]+)%/g)].map((m) => [m[1], Number(m[2])]));
  for (const palette of ["amber", "rose", "emerald"]) {
    const yBg = (vars[`${palette}-50`] / 100) ** 3;
    for (const shade of ["900", "800"]) {
      const y = (vars[`${palette}-${shade}`] / 100) ** 3;
      assert.ok((Math.max(y, yBg) + 0.05) / (Math.min(y, yBg) + 0.05) >= 4.5, `${palette}-${shade} sobre ${palette}-50`);
    }
  }
  assert.ok(contrastRatio(darkHex("#a1a1aa", "text"), darkHex("#1e1e21")) >= 4.5, "texto do cabeçalho PTY sobre a barra escura");
  assert.ok(contrastRatio(darkHex("#71717a", "text"), darkHex("#1e1e21")) >= 4.5, "texto do rodapé PTY sobre a barra escura");
  assert.ok(contrastRatio("#ffffff") > 4.5);
});
