import { t } from "../i18n";
/** Readable name of the action asking for permission (Codex reports the protocol method). */
export function approvalTitle(tool: string): string {
  if (tool === "ExitPlanMode") return t("approval.title.plan");
  if (/commandExecution\/requestApproval$/.test(tool)) return t("approval.title.command");
  if (/fileChange\/requestApproval$/.test(tool)) return t("approval.title.files");
  if (/permissions\/requestApproval$/.test(tool)) return t("approval.title.extraPermission");
  if (/requestApproval$/.test(tool)) return t("approval.title.generic");
  return tool || t("approval.title.tool");
}

export const PROVIDER_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  antigravity: "Antigravity",
};
