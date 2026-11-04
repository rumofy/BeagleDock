import type { AIProviderStatus, PermissionLevel } from "../types";
import { quotaForGeminiModels } from "./agyQuota";

import { getLocale, t } from "../i18n";
// Strips terminal ANSI color codes for clean reading
export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

export const formatQuota = (value: number | null) =>
  value === null ? t("common.na") : `${Math.round(value)}%`;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// "15:20" when the reset is today; "07/11 02:00" (in the interface language's order) otherwise.
export function formatReset(iso?: string | null, now = new Date()): string {
  if (!iso) return t("common.na");
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return t("common.na");
  const time = date.toLocaleTimeString(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
  return sameDay(date, now)
    ? time
    : `${date.toLocaleDateString(getLocale(), { day: "2-digit", month: "2-digit" })} ${time}`;
}

// The machine's time zone as "UTC-3" / "UTC+5:30".
export function localUtcLabel(now = new Date()): string {
  const minutes = -now.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

export const getQuotaColor = (percent: number | null) => {
  if (percent === null) return "text-zinc-700 bg-zinc-100 border-zinc-300";
  if (percent >= 80) return "text-rose-800 bg-rose-50 border-rose-200";
  if (percent >= 50) return "text-amber-800 bg-amber-50 border-amber-200";
  return "text-emerald-800 bg-emerald-50 border-emerald-200";
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
      return "bg-rose-100/80 border-rose-300 text-rose-800";
  }
};
