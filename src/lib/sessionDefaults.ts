import type { AIProviderId, ModelOption, PermissionLevel } from "../types";
import { modelSelection } from "./modelSelection";

/** Modelo, nível de raciocínio e permissão escolhidos por último numa conversa de uma CLI. */
export interface SessionChoice {
  model: string;
  effort: string;
  permission: PermissionLevel;
}

export type SessionChoices = Partial<Record<AIProviderId, SessionChoice>>;

const PERMISSIONS: PermissionLevel[] = ["inherit", "plan", "ask", "edits", "full"];

/** Guarda a escolha da CLI sem tocar nas das outras (o servidor só mescla o primeiro nível). */
export function recordChoice(
  saved: SessionChoices | undefined,
  providerId: AIProviderId,
  choice: SessionChoice,
): SessionChoices {
  return { ...(saved || {}), [providerId]: { ...choice } };
}

/**
 * Escolha com que um chat novo da CLI começa, ou null para usar o padrão da CLI. Só vale com a
 * opção ligada e se o modelo ainda existe no catálogo atual; o nível passa pela mesma validação do
 * seletor, então um nível que o modelo não aceita mais volta ao padrão dele.
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
