import type { AIProviderStatus } from "./types";

export function quotaForGeminiModels(
  quota: AIProviderStatus["quota"],
): AIProviderStatus["quota"] {
  const group = quota.groups?.find(
    (entry) => entry.name.trim().toLowerCase() === "gemini models",
  );
  return {
    ...quota,
    window5hPercent: group?.window5hPercent ?? null,
    weeklyPercent: group?.weeklyPercent ?? null,
    window5hResetAt: group?.window5hResetAt,
    weeklyResetAt: group?.weeklyResetAt,
    groupLabel: group?.name || "Gemini Models",
  };
}
