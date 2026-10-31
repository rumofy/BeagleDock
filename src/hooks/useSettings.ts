import { useEffect, useState } from "react";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import type { AppSettings } from "../types";
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
  };
}
