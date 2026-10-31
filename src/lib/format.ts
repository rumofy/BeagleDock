import type { AIProviderStatus, PermissionLevel } from "../types";
import { quotaForGeminiModels } from "./agyQuota";

// Remove códigos ANSI de cores do terminal para leitura limpa
export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

export const formatQuota = (value: number | null) =>
  value === null ? "N/D" : `${Math.round(value)}%`;

export const getQuotaColor = (percent: number | null) => {
  if (percent === null) return "text-zinc-500 bg-zinc-50 border-zinc-200";
  if (percent >= 80) return "text-rose-600 bg-rose-50 border-rose-200";
  if (percent >= 50) return "text-amber-600 bg-amber-50 border-amber-200";
  return "text-emerald-700 bg-emerald-50 border-emerald-200";
};

export const providerQuota = (provider: AIProviderStatus) =>
  provider.id === "antigravity"
    ? quotaForGeminiModels(provider.quota)
    : provider.quota;

export const permissionStyle = (level: PermissionLevel) => {
  switch (level) {
    case "inherit":
      return "bg-[#ede9de] border-[#dfdacd] text-[#2c2822]";
    case "plan":
      return "bg-sky-100/70 border-sky-200 text-sky-800";
    case "ask":
      return "bg-[#ede9de] border-[#dfdacd] text-[#2c2822]";
    case "edits":
      return "bg-amber-100/70 border-amber-200 text-amber-800";
    case "full":
      return "bg-rose-100/80 border-rose-300 text-rose-700";
  }
};
