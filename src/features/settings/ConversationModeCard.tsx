import { beagleApi, terminalAvailable } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import type { AppSettings } from "../../types";

import { t } from "../../i18n";
type Mode = NonNullable<AppSettings["conversationMode"]>;

const options = (): Array<{ id: Mode; label: string; description: string }> => [
  { id: "terminal", label: t("conversationMode.terminal"), description: t("conversationMode.terminalHint") },
  { id: "chat", label: t("conversationMode.chat"), description: t("conversationMode.chatHint") },
];

/** How conversations open: in the BeagleDock chat or in each CLI's own interface. */
export function ConversationModeCard() {
  const { settings, setSettings, setAppError, hasRunningPrompts } = useApp();
  if (!terminalAvailable()) return null;
  const mode: Mode = settings.conversationMode === "chat" ? "chat" : "terminal";

  const save = async (conversationMode: Mode) => {
    const previous = settings;
    setSettings({ ...settings, conversationMode });
    try {
      const result = await beagleApi.saveAppSettings({ conversationMode } as Partial<AppSettings> as AppSettings);
      if (!result?.success) throw new Error(result?.error || t("settings.saveFailed"));
    } catch (error) {
      setSettings(previous);
      setAppError((error as Error).message);
    }
  };

  return (
    <div data-testid="conversation-mode" className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
      <h2 className="font-bold text-lg text-[#1c1b18] mb-1">{t("conversationMode.title")}</h2>
      <p className="text-xs text-[#7d7565] mb-5">
        {t("conversationMode.intro")}
      </p>
      <div className="space-y-3">
        {options().map((option) => (
          <label key={option.id} className="flex items-start gap-3 text-sm text-[#2c2822]">
            <input
              type="radio"
              name="conversation-mode"
              value={option.id}
              checked={mode === option.id}
              disabled={option.id === "terminal" && mode === "chat" && hasRunningPrompts}
              onChange={() => void save(option.id)}
              className="mt-1"
            />
            <span>
              {option.label}
              <span className="block text-xs text-[#7d7565]">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
      {mode === "chat" && hasRunningPrompts && (
        <p className="mt-3 text-xs text-amber-800">{t("conversationMode.waitRunning")}</p>
      )}
    </div>
  );
}
