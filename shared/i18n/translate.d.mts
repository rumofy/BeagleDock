export type Locale = "en" | "es" | "pt-BR";
export declare const LOCALES: Locale[];
export declare const DEFAULT_LOCALE: Locale;
export declare function resolveLocale(value: unknown): Locale;
export declare function interpolate(text: string, params?: Record<string, unknown>): string;
export declare function createTranslator(
  dictionaries: Record<string, Record<string, string>>,
  getLocale: () => Locale,
): {
  t: (key: string, params?: Record<string, unknown>) => string;
  tn: (key: string, count: number, params?: Record<string, unknown>) => string;
};
