import { beagleApi } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import { PROVIDER_NAMES } from "../../lib/approvalLabels";
import { PERMISSION_LABELS } from "../../lib/permissionModes";
import { rememberedChoice } from "../../lib/sessionDefaults";
import type { AppSettings } from "../../types";

import { t } from "../../i18n";
/** New chats: repeat the model, reasoning level and permission of each CLI's last conversation. */
export function NewChatDefaultsCard() {
  const { settings, setSettings, setAppError, providers } = useApp();
  const enabled = settings.rememberSessionChoices === true;

  const save = async (rememberSessionChoices: boolean) => {
    const previous = settings;
    setSettings({ ...settings, rememberSessionChoices });
    try {
      const result = await beagleApi.saveAppSettings({ rememberSessionChoices } as Partial<AppSettings> as AppSettings);
      if (!result?.success) throw new Error(result?.error || t("settings.saveFailed"));
    } catch (error) {
      setSettings(previous);
      setAppError((error as Error).message);
    }
  };

  // What each CLI's next chat will use, already validated against the current catalog.
  const rows = providers.map((provider) => {
    const choice = rememberedChoice(true, settings.lastSessionChoices, provider.id, provider.modelOptions || []);
    const option = provider.modelOptions?.find((o) => o.id === choice?.model);
    const effort = option?.efforts.find((e) => e.id === choice?.effort);
    const parts = choice
      ? [
          option?.label || choice.model || t("newChat.cliDefaultModel"),
          effort?.label,
          PERMISSION_LABELS[choice.permission],
        ].filter(Boolean)
      : [];
    return { id: provider.id, name: PROVIDER_NAMES[provider.id] || provider.name, summary: parts.join(" · ") };
  });

  return (
    <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
      <h2 className="font-bold text-lg text-[#1c1b18] mb-1">{t("newChat.title")}</h2>
      <p className="text-xs text-[#7d7565] mb-5">
        {t("newChat.intro")}
      </p>
      <label className="flex items-start gap-3 text-sm text-[#2c2822]">
        <input type="checkbox" checked={enabled} onChange={(e) => void save(e.target.checked)} className="mt-1" />
        <span>
          {t("newChat.remember")}
          <span className="block text-xs text-[#7d7565]">
            {t("newChat.rememberHint")}
          </span>
        </span>
      </label>
      {enabled && (
        <ul className="mt-4 space-y-1 text-xs text-[#443e33]">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="font-semibold">{row.name}:</span>{" "}
              {row.summary || <span className="text-[#7d7565]">{t("newChat.noChoice")}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
