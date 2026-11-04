const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const LOCALE_FILES = { en: "en.json", es: "es.json", "pt-BR": "pt-BR.json" };
const dicts = Object.fromEntries(
  Object.entries(LOCALE_FILES).map(([locale, file]) => [
    locale,
    JSON.parse(fs.readFileSync(path.join(root, "shared/i18n", file), "utf8")),
  ]),
);
const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("every locale has the same keys as English", () => {
  const keys = Object.keys(dicts.en).sort();
  for (const [locale, dict] of Object.entries(dicts)) {
    const own = Object.keys(dict).sort();
    assert.deepEqual(
      keys.filter((k) => !own.includes(k)),
      [],
      `keys missing in ${locale}`,
    );
    assert.deepEqual(
      own.filter((k) => !keys.includes(k)),
      [],
      `keys in ${locale} that English doesn't have`,
    );
  }
});

test("every translation keeps the English placeholders and isn't empty", () => {
  for (const [key, text] of Object.entries(dicts.en)) {
    for (const [locale, dict] of Object.entries(dicts)) {
      assert.equal(typeof dict[key], "string", `${locale}: ${key}`);
      assert.ok(dict[key].trim(), `${locale}: ${key} is empty`);
      assert.deepEqual(placeholders(dict[key]), placeholders(text), `${locale}: ${key} placeholders`);
    }
  }
});

test("plural keys come in _one/_other pairs", () => {
  for (const key of Object.keys(dicts.en)) {
    if (key.endsWith("_one")) assert.ok(`${key.slice(0, -4)}_other` in dicts.en, `${key} without _other`);
    if (key.endsWith("_other")) assert.ok(`${key.slice(0, -6)}_one` in dicts.en, `${key} without _one`);
  }
});

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(rel);
  }
  return out;
}

test("every literal key passed to t()/tn() exists in the dictionaries", () => {
  const missing = [];
  for (const file of [...sourceFiles("src"), ...sourceFiles("electron"), ...sourceFiles("shared")]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const m of text.matchAll(/(?<![\w.$])(?:i18n\.)?(t|tn)\(\s*["']([a-zA-Z][\w-]*(?:\.[\w-]+)+)["']/g)) {
      const [, fn, key] = m;
      const ok = fn === "tn" ? `${key}_one` in dicts.en && `${key}_other` in dicts.en : key in dicts.en;
      if (!ok) missing.push(`${file}: ${fn}("${key}")`);
    }
  }
  assert.deepEqual(missing, []);
});

test("the main process translator behaves like the shared one", async () => {
  const shared = await import(path.join(root, "shared/i18n/translate.mjs"));
  const main = require("../electron/i18n");
  assert.deepEqual(main.LOCALES, shared.LOCALES);
  assert.equal(main.DEFAULT_LOCALE, shared.DEFAULT_LOCALE);
  for (const value of ["en", "es", "pt-BR", "pt", "pt_PT", "PT-br", "es-AR", "en-US", "fr", "", null, undefined, 3]) {
    assert.equal(main.resolveLocale(value), shared.resolveLocale(value), String(value));
  }
  for (const [text, params] of [
    ["Hello {name}", { name: "Ana" }],
    ["{a} and {b}", { a: 1 }],
    ["{count} items", { count: 0 }],
    ["no params", undefined],
    ["{name}", { name: null }],
  ])
    assert.equal(main.interpolate(text, params), shared.interpolate(text, params));

  const { t, tn } = shared.createTranslator(dicts, () => "es");
  const previous = main.getLocale();
  try {
    main.setLocale("es");
    for (const key of ["common.close", "approval.allowOnce", "missing.key.here"]) assert.equal(main.t(key), t(key));
    for (const count of [0, 1, 2]) assert.equal(main.tn("background.onlyCommands", count), tn("background.onlyCommands", count));
  } finally {
    main.setLocale(previous);
  }
});

test("locale resolution: English by default, Portuguese variants become pt-BR", async () => {
  const { resolveLocale } = await import(path.join(root, "shared/i18n/translate.mjs"));
  assert.equal(resolveLocale(undefined), "en");
  assert.equal(resolveLocale("fr-FR"), "en");
  assert.equal(resolveLocale("pt"), "pt-BR");
  assert.equal(resolveLocale("pt-PT"), "pt-BR");
  assert.equal(resolveLocale("es-MX"), "es");
});

test("a missing key falls back to English, then to the key itself", async () => {
  const { createTranslator } = await import(path.join(root, "shared/i18n/translate.mjs"));
  const { t, tn } = createTranslator({ en: { a: "A {x}", n_one: "one", n_other: "{count} many" }, es: {} }, () => "es");
  assert.equal(t("a", { x: 1 }), "A 1");
  assert.equal(t("nope"), "nope");
  assert.equal(tn("n", 1), "one");
  assert.equal(tn("n", 3), "3 many");
});
