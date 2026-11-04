import { decimal } from "../i18n";
/** "850 ms", "4.2 s" ("4,2 s" in Spanish and Portuguese), "2:05". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${decimal(ms / 1000, 1)} s`;
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
