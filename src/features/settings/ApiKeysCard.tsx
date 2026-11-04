import {
  CheckCircle2,
} from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";

import { t } from "../../i18n";
export function ApiKeysCard() {
  const {
    settings,
    setSettings,
    settingsSavedBanner,
    handleSaveSettings,
  } = useApp();
  return (
                <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
                  <h2 className="font-bold text-lg text-[#1c1b18] mb-1">
                    {t("apiKeys.title")}
                  </h2>
                  <p className="text-xs text-[#7d7565] mb-6">
                    {t("apiKeys.intro")}
                  </p>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-[#443e33] uppercase tracking-wider mb-1.5">
                        OpenRouter API Key
                      </label>
                      <input
                        type="password"
                        placeholder={
                          settings.configuredSecrets?.openRouterApiKey
                            ? t("dictationSettings.keyConfigured")
                            : t("apiKeys.placeholder")
                        }
                        value={settings.openRouterApiKey || ""}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            openRouterApiKey: e.target.value,
                          })
                        }
                        className="w-full px-3.5 py-2.5 rounded-xl border border-[#d6cfbe] bg-[#fcfbfa] text-sm font-mono outline-none focus:border-[#968d7a]"
                      />
                    </div>

                    <div className="pt-4 border-t border-[#eeeae0] flex items-center justify-between">
                      {settingsSavedBanner ? (
                        <span className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                          <CheckCircle2 size={15} />
                          {t("apiKeys.saved")}
                        </span>
                      ) : (
                        <span />
                      )}
                      <button
                        onClick={handleSaveSettings}
                        className="px-5 py-2.5 rounded-xl bg-[#1c1b18] hover:bg-[#32302b] text-white text-xs font-bold transition"
                      >
                        {t("apiKeys.save")}
                      </button>
                    </div>
                  </div>
                </div>
  );
}
