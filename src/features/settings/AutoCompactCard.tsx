import { beagleApi } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import { AUTO_COMPACT_CHOICES, isAutoCompactChosen, resolveAutoCompact } from "../../lib/autoCompact";
import { formatTokens } from "../../lib/tokens";
import type { AppSettings } from "../../types";

import { t } from "../../i18n";
/** Automatic compaction: keeps the context small while the prompt cache is still warm. */
export function AutoCompactCard() {
  const { settings, setSettings, setAppError } = useApp();
  const picked = isAutoCompactChosen(settings.autoCompactTokens)
    ? resolveAutoCompact(settings.autoCompactTokens)
    : null;
  const choices =
    picked === null || AUTO_COMPACT_CHOICES.includes(picked) || picked === 0
      ? AUTO_COMPACT_CHOICES
      : [...AUTO_COMPACT_CHOICES, picked].sort((a, b) => a - b);

  // null goes back to automatic (follows the model's window).
  const save = async (autoCompactTokens: number | null) => {
    const previous = settings;
    setSettings({ ...settings, autoCompactTokens });
    try {
      const result = await beagleApi.saveAppSettings({ autoCompactTokens } as Partial<AppSettings> as AppSettings);
      if (!result?.success) throw new Error(result?.error || t("settings.saveFailed"));
    } catch (error) {
      setSettings(previous);
      setAppError((error as Error).message);
    }
  };

  return (
    <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
      <h2 className="font-bold text-lg text-[#1c1b18] mb-1">{t("autoCompact.title")}</h2>
      <p className="text-xs text-[#7d7565] mb-5">
        {t("autoCompact.intro")}
      </p>
      <label className="flex items-center gap-2 text-xs font-semibold text-[#443e33]">
        {t("autoCompact.from")}
        <select
          aria-label={t("autoCompact.limitLabel")}
          value={picked === null ? "auto" : picked}
          onChange={(e) => void save(e.target.value === "auto" ? null : Number(e.target.value))}
          className="rounded-lg border border-[#d6cfbe] bg-[#faf8f4] px-2 py-1 text-xs"
        >
          <option value="auto">{t("autoCompact.auto")}</option>
          <option value={0}>{t("autoCompact.never")}</option>
          {choices.map((tokens) => (
            <option key={tokens} value={tokens}>
              {formatTokens(tokens)} tokens
            </option>
          ))}
        </select>
      </label>
      <p className="mt-3 text-xs text-[#7d7565]">
        {t("autoCompact.note")}
      </p>
    </div>
  );
}
