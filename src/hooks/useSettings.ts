import { useEffect, useRef, useState } from "react";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import { recordChoice, type SessionChoice } from "../lib/sessionDefaults";
import type { AIProviderId, AppSettings } from "../types";
import type { GlobalPolicy } from "../types/api";

export function useSettings(setAppError: (message: string) => void) {
  const [settingsSavedBanner, setSettingsSavedBanner] =
    useState<boolean>(false);
  const [globalPolicies, setGlobalPolicies] = useState<GlobalPolicy[]>([]);
  const [policyDrafts, setPolicyDrafts] = useState<
    Record<string, Record<string, string>>
  >({});
  const [cliFeedback, setCliFeedback] = useState<
    Record<string, string | undefined>
  >({});
  const [cliUpdating, setCliUpdating] = useState<string>("");
  const [settings, setSettings] = useState<AppSettings>({
    defaultProvider: "claude",
    theme: "cream",
    workspaces: [],
  });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Última escolha de modelo, nível e permissão da CLI; vale para os próximos chats se a opção
  // estiver ligada. Grava o mapa inteiro porque o servidor só mescla o primeiro nível.
  const recordSessionChoice = (providerId: AIProviderId, choice: SessionChoice) => {
    const lastSessionChoices = recordChoice(
      settingsRef.current.lastSessionChoices,
      providerId,
      choice,
    );
    settingsRef.current = { ...settingsRef.current, lastSessionChoices };
    setSettings((prev) => ({ ...prev, lastSessionChoices }));
    if (!backendAvailable()) return;
    beagleApi
      .saveAppSettings({ lastSessionChoices } as Partial<AppSettings> as AppSettings)
      .then((result) => {
        if (!result?.success)
          throw new Error(result?.error || "Falha ao guardar a escolha da conversa.");
      })
      .catch((error: Error) => setAppError(error.message));
  };
  useEffect(() => {
    if (!backendAvailable()) return;
    beagleApi
      .getGlobalPermissions()
      .then(setGlobalPolicies)
      .catch((e: Error) => setAppError(e.message));
  }, []);
  const handleSaveSettings = async () => {
    try {
      // O zoom é gravado por Ctrl +/−; o valor guardado no estado pode estar velho.
      const { zoomFactor: _stale, ...toSave } = settings;
      void _stale;
      const result = await beagleApi.saveAppSettings(toSave as typeof settings);
      if (!result?.success)
        throw new Error(result?.error || "Falha ao salvar configurações.");
      setSettings(result.settings);
      setAppError("");
      setSettingsSavedBanner(true);
      setTimeout(() => setSettingsSavedBanner(false), 3000);
    } catch (error) {
      setAppError((error as Error).message);
    }
  };
  return {
    settings,
    setSettings,
    settingsSavedBanner,
    globalPolicies,
    setGlobalPolicies,
    policyDrafts,
    setPolicyDrafts,
    cliFeedback,
    setCliFeedback,
    cliUpdating,
    setCliUpdating,
    handleSaveSettings,
    recordSessionChoice,
  };
}
