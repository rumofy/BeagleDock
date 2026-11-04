import type { AppSettings } from "../types";

export type ThemeSetting = AppSettings["theme"];
export type ResolvedTheme = "light" | "dark";

/** "cream" is the original light theme; "system" follows the operating system preference. */
export function resolveTheme(setting: ThemeSetting | undefined, prefersDark: boolean): ResolvedTheme {
  if (setting === "dark") return "dark";
  if (setting === "system") return prefersDark ? "dark" : "light";
  return "light";
}

export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 1.6;
export const ZOOM_STEP = 0.1;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value)) * 100) / 100;
}
