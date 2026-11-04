import en from "../../shared/i18n/en.json";
import es from "../../shared/i18n/es.json";
import ptBR from "../../shared/i18n/pt-BR.json";
import {
  createTranslator,
  DEFAULT_LOCALE,
  LOCALES,
  resolveLocale,
  type Locale,
} from "../../shared/i18n/translate.mjs";

export type { Locale };
export { LOCALES, resolveLocale };

/** Every key of the English dictionary (the source of truth). */
export type MessageKey = keyof typeof en;
/** Keys that have `_one`/`_other` plural forms, without the suffix. */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}_one` ? Base : never;
}[MessageKey];
type Params = Record<string, string | number | null | undefined>;

let current: Locale = DEFAULT_LOCALE;
const translator = createTranslator(
  { en, es, "pt-BR": ptBR } as Record<string, Record<string, string>>,
  () => current,
);

/** Active interface language. The app shell re-renders when it changes (see AppStateProvider). */
export function getLocale(): Locale {
  return current;
}
export function setLocale(locale: unknown) {
  current = resolveLocale(locale);
  if (typeof document !== "undefined") document.documentElement.lang = current;
}

export const t = (key: MessageKey, params?: Params) => translator.t(key, params);
export const tn = (key: PluralKey, count: number, params?: Params) =>
  translator.tn(key, count, params);

/** Formats a decimal with the interface language's separator ("4.2" in English, "4,2" otherwise). */
export const decimal = (value: number, digits: number) =>
  value.toFixed(digits).replace(".", current === "en" ? "." : ",");

/** Language names, each written in its own language so anyone can find theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  "pt-BR": "Português (Brasil)",
};
