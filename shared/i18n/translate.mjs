// Shared translation logic for the renderer (ESM) and the Electron main process (via
// electron/i18n.js). Dictionaries are flat JSON files keyed by dotted ids; English is the source of
// truth, and a test checks that every locale has the same keys and placeholders.

export const LOCALES = ["en", "es", "pt-BR"];
export const DEFAULT_LOCALE = "en";

/** Normalizes a saved or system language to one of the supported locales. */
export function resolveLocale(value) {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  if (LOCALES.includes(value)) return value;
  const base = value.toLowerCase().split(/[-_]/)[0];
  if (base === "pt") return "pt-BR";
  return LOCALES.includes(base) ? base : DEFAULT_LOCALE;
}

/** Replaces `{name}` placeholders; unknown placeholders are left visible instead of vanishing. */
export function interpolate(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(params, name) && params[name] != null ? String(params[name]) : match,
  );
}

/**
 * Builds `t` and `tn` over a set of dictionaries. A key missing in the active locale falls back to
 * English, then to the key itself, so a missing translation never breaks the screen.
 */
export function createTranslator(dictionaries, getLocale) {
  const lookup = (key) => {
    const locale = getLocale();
    return dictionaries[locale]?.[key] ?? dictionaries[DEFAULT_LOCALE]?.[key] ?? key;
  };
  const t = (key, params) => interpolate(lookup(key), params);
  // Plurals: `<key>_one` for exactly 1, `<key>_other` otherwise (same rule in all three languages).
  const tn = (key, count, params) =>
    interpolate(lookup(`${key}_${count === 1 ? "one" : "other"}`), { count, ...params });
  return { t, tn };
}
