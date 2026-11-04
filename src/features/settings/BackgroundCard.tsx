import { beagleApi } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import type { AppSettings } from "../../types";

import { t } from "../../i18n";
/** Background: the app in the tray and starting with the system. */
export function BackgroundCard() {
  const { settings, setSettings, setAppError } = useApp();
  const inBackground = settings.runInBackground !== false;
  const atLogin = settings.launchAtLogin === true;

  // Only the changed key: the server merges it with the rest. If it can't be applied (e.g. the
  // autostart file), the interface goes back to the previous value.
  const save = async (change: Partial<AppSettings>) => {
    const previous = settings;
    setSettings({ ...settings, ...change });
    try {
      const result = await beagleApi.saveAppSettings(change as AppSettings);
      if (!result?.success) throw new Error(result?.error || t("settings.saveFailed"));
    } catch (error) {
      setSettings(previous);
      setAppError((error as Error).message);
    }
  };

  return (
    <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
      <h2 className="font-bold text-lg text-[#1c1b18] mb-1">{t("backgroundSettings.title")}</h2>
      <p className="text-xs text-[#7d7565] mb-5">
        {t("backgroundSettings.intro")}
      </p>
      <label className="flex items-start gap-3 text-sm text-[#2c2822]">
        <input
          type="checkbox"
          checked={inBackground}
          onChange={(e) => void save({ runInBackground: e.target.checked })}
          className="mt-1"
        />
        <span>
          {t("backgroundSettings.tray")}
          <span className="block text-xs text-[#7d7565]">
            {t("backgroundSettings.trayHint")}
          </span>
        </span>
      </label>
      <label className="mt-3 flex items-start gap-3 text-sm text-[#2c2822]">
        <input
          type="checkbox"
          checked={atLogin}
          onChange={(e) => void save({ launchAtLogin: e.target.checked })}
          className="mt-1"
        />
        <span>
          {t("backgroundSettings.autostart")}
          <span className="block text-xs text-[#7d7565]">{t("backgroundSettings.autostartHint")}</span>
        </span>
      </label>
    </div>
  );
}
