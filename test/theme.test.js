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

test("theme: light by default, dark when asked and system follows the preference", () => {
  assert.equal(resolveTheme("cream", true), "light");
  assert.equal(resolveTheme(undefined, true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("zoom respects the limits and invalid values go back to 100%", () => {
  assert.equal(clampZoom(0.2), 0.7);
  assert.equal(clampZoom(9), 1.6);
  assert.equal(clampZoom(1.2345), 1.23);
  assert.equal(clampZoom(NaN), 1);
  assert.equal(zoom.clamp(Infinity), 1);
});

test("zoom shortcuts: Ctrl +, Ctrl -, Ctrl 0; other keys pass through", () => {
  const key = (k, extra = {}) => ({ type: "keyDown", control: true, key: k, ...extra });
  assert.equal(zoom.zoomForKey(key("="), 1), 1.1);
  assert.equal(zoom.zoomForKey(key("+"), 1.5), 1.6);
  assert.equal(zoom.zoomForKey(key("+"), 1.6), 1.6, "doesn't go past the maximum");
  assert.equal(zoom.zoomForKey(key("-"), 1), 0.9);
  assert.equal(zoom.zoomForKey(key("0"), 1.4), 1);
  assert.equal(zoom.zoomForKey(key("a"), 1), null);
  assert.equal(zoom.zoomForKey({ type: "keyDown", key: "=" }, 1), null, "without Ctrl it isn't zoom");
  assert.equal(zoom.zoomForKey(key("=", { type: "keyUp" }), 1), null);
  assert.equal(zoom.zoomForKey(key("=", { alt: true }), 1), null);
});

test("the dark conversion follows the VS Code pattern, inverts lightness and keeps transparency", async () => {
  const { darkHex } = await import("../scripts/gen-dark-theme.mjs");
  const lum = (hex) => {
    const n = (i) => parseInt(hex.slice(1 + i, 3 + i), 16);
    return (Math.max(n(0), n(2), n(4)) + Math.min(n(0), n(2), n(4))) / 510;
  };
  assert.ok(lum(darkHex("#fcfbfa")) < 0.15, "the cream background becomes almost black (VS Code editor)");
  assert.ok(lum(darkHex("#1c1b18", "text")) > 0.85, "dark text becomes light");
  assert.ok(lum(darkHex("#141416")) < 0.15, "an already dark PTY console stays dark in the dark theme");
  assert.ok(lum(darkHex("#1e1e21")) < 0.18, "barra do console PTY permanece escura no tema escuro");
  assert.equal(darkHex("#ffffff80").length, 9, "keeps the alpha channel");
  assert.match(darkHex("#fff"), /^#[0-9a-f]{6}$/);
});

test("the dark theme CSS is up to date with the colors used in the app and follows the VS Code pattern", async () => {
  const { generateDarkCss } = await import("../scripts/gen-dark-theme.mjs");
  const { css, unsupported } = generateDarkCss();
  const current = fs.readFileSync(path.resolve("src/dark-theme.generated.css"), "utf8");
  assert.equal(current, css, "rode `npm run theme:gen`");
  assert.deepEqual(unsupported, [], "there are color variants without a dark theme");
  assert.match(css, /:root\[data-theme="dark"\] body \{ background: #1e1e1e; color: #d4d4d4; \}/);
  assert.match(css, /:root\[data-theme="dark"\] select option, :root\[data-theme="dark"\] select optgroup \{ background-color: #252526; color: #dbdbdc; \}/);
  assert.match(css, /--color-white: #252526;/);
  assert.match(css, /:root\[data-theme="dark"\] \.hover\\:bg-\\\[\\#/);
});

test("every hex text color of the dark theme has a minimum contrast of 4.5:1 over the lightest surface", async () => {
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
  assert.ok(checked > 10, "the test must find the text rules");
  assert.deepEqual(low, []);
});

test("the light theme's mid grays (#7d7565, #938b7a, #8c8270) stay readable in dark", async () => {
  const { darkHex, contrastRatio } = await import("../scripts/gen-dark-theme.mjs");
  for (const hex of ["#7d7565", "#938b7a", "#8c8270", "#6d6657", "#9d9483"])
    assert.ok(contrastRatio(darkHex(hex, "text")) >= 4.5, hex);
});

test("named palette text (300–500) and the permission card's text/background pairs stay readable in dark", async () => {
  const { generateDarkCss, contrastRatio, darkHex } = await import("../scripts/gen-dark-theme.mjs");
  const { css } = generateDarkCss();
  // OKLCH: Y ≈ (L/100)^3; the dark theme's lightest surface (#24211c) has Y ≈ 0.0154.
  const ratioOklch = (l) => ((l / 100) ** 3 + 0.05) / (0.0154 + 0.05);
  const found = [];
  const low = [];
  for (const line of css.split("\n")) {
    const m = line.match(/^:root\[data-theme="dark"\] \.(text-\S+?) \{ color: oklch\(([\d.]+)%/);
    if (!m) continue;
    found.push(m[1]);
    if (ratioOklch(Number(m[2])) < 4.5) low.push(`${m[1]} L=${m[2]}%`);
  }
  assert.ok(found.length >= 1, "there's named palette text with its own rule");
  assert.deepEqual(low, []);
  // Permission card and quota badges: 800/900 text over the swapped 50 background (950).
  const vars = Object.fromEntries([...css.matchAll(/--color-((?:amber|rose|emerald)-\d+): oklch\(([\d.]+)%/g)].map((m) => [m[1], Number(m[2])]));
  for (const palette of ["amber", "rose", "emerald"]) {
    const yBg = (vars[`${palette}-50`] / 100) ** 3;
    for (const shade of ["900", "800"]) {
      const y = (vars[`${palette}-${shade}`] / 100) ** 3;
      assert.ok((Math.max(y, yBg) + 0.05) / (Math.min(y, yBg) + 0.05) >= 4.5, `${palette}-${shade} over ${palette}-50`);
    }
  }
  assert.ok(contrastRatio(darkHex("#a1a1aa", "text"), darkHex("#1e1e21")) >= 4.5, "PTY header text over the dark bar");
  assert.ok(contrastRatio(darkHex("#71717a", "text"), darkHex("#1e1e21")) >= 4.5, "PTY footer text over the dark bar");
  assert.ok(contrastRatio("#ffffff") > 4.5);
});
