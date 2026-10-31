import { useEffect } from "react";
import { resolveTheme, type ThemeSetting } from "../lib/theme";

/** Aplica o tema no <html>; com "system", acompanha a preferência do sistema em tempo real. */
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
