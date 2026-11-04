import { useEffect, useState } from "react";
import { Languages, Minus, Monitor, Moon, Plus, Sun } from "lucide-react";
import { backendAvailable, beagleApi } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import { clampZoom, ZOOM_STEP, type ThemeSetting } from "../../lib/theme";

import { LOCALE_NAMES, LOCALES, t, type Locale } from "../../i18n";
const themes = (): Array<{ id: ThemeSetting; label: string; icon: typeof Sun }> => [
  { id: "cream", label: t("appearance.light"), icon: Sun },
  { id: "dark", label: t("appearance.dark"), icon: Moon },
  { id: "system", label: t("appearance.system"), icon: Monitor },
];

export function AppearanceCard() {
  const { settings, setSettings, setAppError, locale } = useApp();
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!backendAvailable()) return;
    beagleApi
      .getZoom()
      .then(setZoom)
      .catch(() => {});
  }, []);

  const chooseTheme = async (theme: ThemeSetting) => {
    setSettings({ ...settings, theme });
    try {
      // Only the theme: the server merges it with the rest (an old zoomFactor in the state doesn't overwrite the current one).
      const result = await beagleApi.saveAppSettings({
        theme,
      } as typeof settings);
      if (!result?.success)
        throw new Error(result?.error || t("appearance.saveFailed"));
    } catch (error) {
      setAppError((error as Error).message);
    }
  };
  // Only the language: the whole interface redraws in it right away (the main process follows too).
  const chooseLanguage = async (language: Locale) => {
    const previous = settings;
    setSettings({ ...settings, language });
    try {
      const result = await beagleApi.saveAppSettings({ language } as typeof settings);
      if (!result?.success) throw new Error(result?.error || t("settings.saveFailed"));
    } catch (error) {
      setSettings(previous);
      setAppError((error as Error).message);
    }
  };
  const changeZoom = async (factor: number) => {
    try {
      setZoom(await beagleApi.setZoom(clampZoom(factor)));
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  return (
    <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
      <h2 className="font-bold text-lg text-[#1c1b18] mb-1">{t("appearance.title")}</h2>
      <p className="text-xs text-[#7d7565] mb-5">
        {t("appearance.intro")}
      </p>
      <label className="flex items-center gap-2 mb-5 text-xs font-bold text-[#2c2822]">
        <Languages size={14} />
        {t("appearance.language")}
        <select
          value={locale}
          onChange={(e) => void chooseLanguage(e.target.value as Locale)}
          className="px-2.5 py-1.5 rounded-xl border border-[#d6cfbe] bg-[#f4f1e8] text-xs font-semibold outline-none"
        >
          {LOCALES.map((id) => (
            <option key={id} value={id}>
              {LOCALE_NAMES[id]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-6">
        <div role="radiogroup" aria-label={t("appearance.theme")} className="flex gap-2">
          {themes().map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={settings.theme === id}
              onClick={() => chooseTheme(id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition ${
                settings.theme === id
                  ? "bg-[#1c1b18] text-white border-[#1c1b18]"
                  : "bg-[#f4f1e8] text-[#2c2822] border-[#d6cfbe] hover:bg-[#ede9de]"
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2" aria-label={t("appearance.zoom")}>
          <button
            type="button"
            onClick={() => changeZoom(zoom - ZOOM_STEP)}
            className="p-2 rounded-xl border border-[#d6cfbe] bg-[#f4f1e8] hover:bg-[#ede9de]"
            aria-label={t("appearance.zoomOut")}
          >
            <Minus size={14} />
          </button>
          <span className="w-14 text-center text-xs font-mono">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => changeZoom(zoom + ZOOM_STEP)}
            className="p-2 rounded-xl border border-[#d6cfbe] bg-[#f4f1e8] hover:bg-[#ede9de]"
            aria-label={t("appearance.zoomIn")}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            onClick={() => changeZoom(1)}
            className="px-3 py-2 rounded-xl text-xs font-semibold text-[#6d6657] hover:bg-[#ede9de]"
          >
            {t("appearance.reset")}
          </button>
        </div>
      </div>
    </div>
  );
}
