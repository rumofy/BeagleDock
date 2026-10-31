import { useEffect, useState } from "react";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import type { AIProviderStatus } from "../types";
import type { ToolsUpdate, UpdateInfo } from "../types/api";

function provider(
  id: AIProviderStatus["id"],
  name: string,
  iconBg: string,
  badgeColor: string,
): AIProviderStatus {
  return {
    id,
    name,
    type: "cli",
    role: "Desenvolvimento",
    iconBg,
    badgeColor,
    installed: false,
    quota: { window5hPercent: null, weeklyPercent: null },
    supportedModels: [],
    mcps: [],
    sessions: [],
  };
}

export function useProviders({
  onUpdates,
  setAppError,
}: {
  onUpdates: (updates: UpdateInfo) => void;
  setAppError: (message: string) => void;
}) {
  const [providers, setProviders] = useState<AIProviderStatus[]>([
    provider("claude", "Claude Code", "#7c3aed", "bg-purple-600"),
    provider("codex", "Codex CLI", "#059669", "bg-emerald-600"),
    provider("antigravity", "Antigravity", "#db2777", "bg-pink-600"),
  ]);
  // Ferramentas instaladas, Modelos, MCPs e Cotas Reais (inicial + push em tempo real)
  useEffect(() => {
    if (!backendAvailable()) return;
    const applyToolsUpdate = (res?: ToolsUpdate) => {
      if (!res) return;
      const { tools, quotas } = res;
      if (res.updates) onUpdates(res.updates);
      setProviders((prev) =>
        prev.map((p) => {
          const toolInfo = tools?.[p.id];
          const quotaInfo = quotas?.[p.id];
          return {
            ...p,
            installed: !!toolInfo?.installed,
            cliPath: toolInfo?.path || undefined,
            cliVersion: toolInfo?.version || undefined,
            modelOptions: Array.isArray(toolInfo?.modelOptions)
              ? toolInfo.modelOptions
              : [],
            supportedModels: Array.isArray(toolInfo?.models)
              ? toolInfo.models
              : [],
            activeModel: toolInfo?.activeModel || "",
            modelsSource: toolInfo?.modelsSource,
            modelsUpdatedAt: toolInfo?.modelsUpdatedAt,
            modelsError: toolInfo?.modelsError,
            mcps: Array.isArray(toolInfo?.mcps) ? toolInfo.mcps : [],
            quota: quotaInfo || p.quota,
          };
        }),
      );
    };
    beagleApi
      .detectTools()
      .then(applyToolsUpdate)
      .catch((error: Error) => setAppError(error.message));
    return beagleApi.on("tools-update", applyToolsUpdate);
  }, []);
  return { providers, setProviders };
}
