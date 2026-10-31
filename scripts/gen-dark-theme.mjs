// Gera src/dark-theme.generated.css a partir das cores realmente usadas nas classes do app.
// Cores em hexadecimal são invertidas em luminosidade; a paleta nomeada do Tailwind troca as faixas
// (50↔950, 100↔900…). Rode `npm run theme:gen` depois de mexer em cores; o teste acusa arquivo velho.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "src/dark-theme.generated.css");

const PROPS = {
  bg: ["background-color"],
  text: ["color"],
  border: ["border-color"],
  ring: ["--tw-ring-color"],
  fill: ["fill"],
  stroke: ["stroke"],
  outline: ["outline-color"],
  accent: ["accent-color"],
  caret: ["caret-color"],
  decoration: ["text-decoration-color"],
  shadow: ["--tw-shadow-color"],
  from: ["--tw-gradient-from"],
  via: ["--tw-gradient-via"],
  to: ["--tw-gradient-to"],
};
const VARIANTS = {
  hover: ":hover",
  focus: ":focus",
  "focus-within": ":focus-within",
  active: ":active",
  disabled: ":disabled",
};
const PALETTES = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky",
  "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose", "slate", "gray", "zinc",
  "neutral", "stone",
];
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const PARTNER = { 50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 500: 500, 600: 400, 700: 300, 800: 200, 900: 100, 950: 50 };

export function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(name) && !name.endsWith(".generated.css")) out.push(full);
  }
  return out;
}

const esc = (value) => value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);

function hexToRgba(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}
function hslToHex({ h, s, l }, a) {
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => {
    const m = s * Math.min(l, 1 - l);
    return l - m * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  };
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}${a < 1 ? to(a) : ""}`;
}
// Texto precisa de contraste, não só de inversão: cinzas médios do tema claro continuariam
// médios sobre o fundo escuro. Por isso o texto nunca fica abaixo de uma luminosidade mínima.
const TEXT_PROPS = new Set(["text", "placeholder", "decoration", "caret"]);
const TEXT_MIN_LIGHTNESS = 0.66;
const SURFACE_BASE = "#24211c"; // o fundo mais claro sobre o qual um texto pode aparecer no escuro

export function darkHex(hex, role = "surface") {
  const rgba = hexToRgba(hex);
  const hsl = rgbToHsl(rgba);
  const inverted = 1 - hsl.l;
  const l =
    role === "text"
      ? Math.min(0.97, Math.max(TEXT_MIN_LIGHTNESS, inverted))
      : Math.min(0.96, Math.max(0.07, inverted));
  return hslToHex({ h: hsl.h, s: hsl.s * (role === "text" ? 0.7 : 0.85), l }, rgba.a);
}

function luminance(hex) {
  const { r, g, b } = hexToRgba(hex);
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrastRatio(foreground, background = SURFACE_BASE) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function themeColors() {
  const css = readFileSync(path.join(root, "node_modules/tailwindcss/theme.css"), "utf8");
  const colors = new Map();
  for (const m of css.matchAll(/--color-([a-z]+)-(\d+):\s*([^;]+);/g))
    colors.set(`${m[1]}-${m[2]}`, m[3].trim());
  return colors;
}

export function generateDarkCss() {
  const tokenRe = new RegExp(
    `((?:[a-z0-9-]+:)*)(${Object.keys(PROPS).join("|")})-\\[(#[0-9a-fA-F]{3,8})\\](?:/(\\d+))?`,
    "g",
  );
  const paletteRe = new RegExp(`\\b(?:[a-z-]+:)*(?:${Object.keys(PROPS).join("|")})-(${PALETTES.join("|")})-(\\d+)`, "g");
  const rules = new Map();
  const used = new Set();
  const unsupported = new Set();
  for (const file of walk(path.join(root, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(paletteRe)) used.add(m[1]);
    for (const m of text.matchAll(tokenRe)) {
      const [whole, variantText, prop, hex, opacity] = m;
      const variants = variantText.split(":").filter(Boolean);
      if (variants.some((v) => !VARIANTS[v])) {
        unsupported.add(whole);
        continue;
      }
      const dark = darkHex(hex, TEXT_PROPS.has(prop) ? "text" : "surface");
      const value = opacity ? `color-mix(in oklab, ${dark} ${opacity}%, transparent)` : dark;
      const pseudo = variants.map((v) => VARIANTS[v]).join("");
      const declarations = PROPS[prop].map((p) => `${p}: ${value};`).join(" ");
      rules.set(whole, `:root[data-theme="dark"] .${esc(whole)}${pseudo} { ${declarations} }`);
    }
  }
  const colors = themeColors();
  // Texto em tons médios da paleta (300–500) mantém a cor original: trocar de faixa o deixaria
  // escuro demais sobre o fundo escuro.
  const textRe = new RegExp(`((?:[a-z0-9-]+:)*)text-(${PALETTES.join("|")})-(300|400|500)\\b`, "g");
  for (const file of walk(path.join(root, "src"))) {
    for (const m of readFileSync(file, "utf8").matchAll(textRe)) {
      const [whole, variantText, name, shade] = m;
      const variants = variantText.split(":").filter(Boolean);
      // 500 sozinho não alcança 4,5:1 sobre o fundo escuro: usa a cor da faixa 400.
      const original = colors.get(`${name}-${shade === "500" ? "400" : shade}`);
      if (!original || variants.some((v) => !VARIANTS[v])) continue;
      const pseudo = variants.map((v) => VARIANTS[v]).join("");
      rules.set(whole, `:root[data-theme="dark"] .${esc(whole)}${pseudo} { color: ${original}; }`);
    }
  }
  const vars = [];
  for (const name of [...used].sort())
    for (const shade of SHADES) {
      const own = colors.get(`${name}-${shade}`);
      const swapped = colors.get(`${name}-${PARTNER[shade]}`);
      if (own && swapped && shade !== 500) vars.push(`  --color-${name}-${shade}: ${swapped};`);
    }
  const lines = [
    "/* GERADO por scripts/gen-dark-theme.mjs — não edite; rode `npm run theme:gen`. */",
    ':root[data-theme="dark"] {',
    "  color-scheme: dark;",
    "  --color-white: #24211c;",
    ...vars,
    "}",
    ':root[data-theme="dark"] body { background: #14130f; color: #ece7da; }',
    ':root[data-theme="dark"] ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.18); }',
    ':root[data-theme="dark"] ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.3); }',
    ...[...rules.keys()].sort().map((k) => rules.get(k)),
    "",
  ];
  return { css: lines.join("\n"), unsupported: [...unsupported].sort() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { css, unsupported } = generateDarkCss();
  writeFileSync(OUT, css);
  console.log(`Tema escuro gerado: ${css.split("\n").length} linhas.`);
  if (unsupported.length) console.warn("Variantes sem tema escuro:", unsupported.join(", "));
}
