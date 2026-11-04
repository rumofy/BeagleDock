import { useEffect } from "react";
import { resolveTheme, type ThemeSetting } from "../lib/theme";

/** Applies the theme to <html>; with "system", it follows the system preference live. */
export function useTheme(setting: ThemeSetting | undefined) {
  useEffect(() => {
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(setting, !!media?.matches);
    };
    apply();
    if (setting !== "system" || !media) return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [setting]);
}
