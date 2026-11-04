// Interface language for the main process (notifications, tray menu, dialogs, error messages
// shown in the app). Same dictionaries as the renderer, in shared/i18n.
const en = require("../shared/i18n/en.json");
const es = require("../shared/i18n/es.json");
const ptBR = require("../shared/i18n/pt-BR.json");

// shared/i18n/translate.mjs is ESM; this CommonJS copy of the same small rules keeps `require`
// synchronous. test/i18n.test.js checks that both behave the same.
const LOCALES = ["en", "es", "pt-BR"];
const DEFAULT_LOCALE = "en";
const dictionaries = { en, es, "pt-BR": ptBR };
let current = DEFAULT_LOCALE;

function resolveLocale(value) {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  if (LOCALES.includes(value)) return value;
  const base = value.toLowerCase().split(/[-_]/)[0];
  if (base === "pt") return "pt-BR";
  return LOCALES.includes(base) ? base : DEFAULT_LOCALE;
}
function interpolate(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(params, name) && params[name] != null ? String(params[name]) : match,
  );
}
const lookup = (key) => dictionaries[current]?.[key] ?? en[key] ?? key;
const t = (key, params) => interpolate(lookup(key), params);
const tn = (key, count, params) =>
  interpolate(lookup(`${key}_${count === 1 ? "one" : "other"}`), { count, ...params });

module.exports = {
  LOCALES,
  DEFAULT_LOCALE,
  resolveLocale,
  interpolate,
  t,
  tn,
  getLocale: () => current,
  setLocale: (value) => (current = resolveLocale(value)),
};
