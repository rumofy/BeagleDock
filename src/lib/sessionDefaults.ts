import type { AIProviderId, ModelOption, PermissionLevel } from "../types";
import { modelSelection } from "./modelSelection";

/** Model, reasoning level and permission last chosen in a conversation of a CLI. */
export interface SessionChoice {
  model: string;
  effort: string;
  permission: PermissionLevel;
}

export type SessionChoices = Partial<Record<AIProviderId, SessionChoice>>;

const PERMISSIONS: PermissionLevel[] = ["inherit", "plan", "ask", "edits", "full"];

/** Stores the CLI's choice without touching the others (the server only merges the first level). */
export function recordChoice(
  saved: SessionChoices | undefined,
  providerId: AIProviderId,
  choice: SessionChoice,
): SessionChoices {
  return { ...(saved || {}), [providerId]: { ...choice } };
}

/**
 * Choice a new chat of the CLI starts with, or null to use the CLI's default. Only applies with the
 * option on and if the model still exists in the current catalog; the level goes through the same
 * validation as the picker, so a level the model no longer accepts falls back to its default.
 */
export function rememberedChoice(
  enabled: boolean | undefined,
  saved: SessionChoices | undefined,
  providerId: AIProviderId,
  options: ModelOption[],
): SessionChoice | null {
  if (!enabled) return null;
  const choice = saved?.[providerId];
  if (!choice) return null;
  let model = "";
  let effort = "";
  if (choice.model) {
    const selected = modelSelection(options, choice.model, choice.effort || "");
    if (selected.option) {
      model = selected.model;
      effort = selected.effort;
    }
  }
  const permission = PERMISSIONS.includes(choice.permission) ? choice.permission : "inherit";
  return { model, effort, permission };
}
