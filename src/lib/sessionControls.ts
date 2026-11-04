import { t } from "../i18n";
export type SessionControl = "model" | "effort" | "permission";

/**
 * Native commands that change the session context and that the app controls with its own picker:
 * the picker is the source of truth (each turn starts the CLI with its model, effort and permission),
 * so running the command blindly in the CLI wouldn't change the conversation. The command list still
 * comes from the CLI; this only maps the command name to the matching picker.
 */
const CONTROL_BY_COMMAND: Record<string, SessionControl> = {
  model: "model",
  effort: "effort",
  permissions: "permission",
  permission: "permission",
};

/** App controls that work for any CLI; listed when the CLI doesn't report its commands. */
export const appControlCommands = () => [
  { name: "model", kind: "app" as const, description: t("sessionControls.model") },
  { name: "effort", kind: "app" as const, description: t("sessionControls.effort") },
  { name: "permissions", kind: "app" as const, description: t("sessionControls.permissions") },
];

export function controlForCommand(input: string): SessionControl | null {
  const match = /^\/([\w-]+)\s*$/.exec(input.trim());
  return match ? (CONTROL_BY_COMMAND[match[1].toLowerCase()] ?? null) : null;
}

/** Focuses the picker and opens it; returns false when it doesn't exist or is disabled. */
export function openSessionControl(control: SessionControl): boolean {
  const element = document.querySelector<HTMLSelectElement>(`select[data-control="${control}"]`);
  if (!element || element.disabled) return false;
  element.focus();
  try {
    element.showPicker?.();
  } catch {
    /* focus already highlights the picker */
  }
  return true;
}
