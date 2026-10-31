export type SessionControl = "model" | "effort" | "permission";

/**
 * Comandos nativos que mudam o contexto da sessão e que o app controla pelo seletor gráfico:
 * o seletor é a fonte do estado (cada turno sai da CLI com o modelo, o esforço e a permissão dele),
 * então rodar o comando às cegas na CLI não alteraria a conversa. A lista de comandos continua
 * vinda da CLI; aqui só se liga o nome do comando ao seletor correspondente.
 */
const CONTROL_BY_COMMAND: Record<string, SessionControl> = {
  model: "model",
  effort: "effort",
  permissions: "permission",
  permission: "permission",
};

/** Controles do app que valem para qualquer CLI; entram na lista quando a CLI não informa os comandos. */
export const APP_CONTROL_COMMANDS = [
  { name: "model", kind: "app" as const, description: "Escolher o modelo (seletor do app)" },
  { name: "effort", kind: "app" as const, description: "Escolher o nível de raciocínio (seletor do app)" },
  { name: "permissions", kind: "app" as const, description: "Escolher a permissão (seletor do app)" },
];

export function controlForCommand(input: string): SessionControl | null {
  const match = /^\/([\w-]+)\s*$/.exec(input.trim());
  return match ? (CONTROL_BY_COMMAND[match[1].toLowerCase()] ?? null) : null;
}

/** Leva o foco ao seletor e o abre; devolve false se ele não existe ou está bloqueado. */
export function openSessionControl(control: SessionControl): boolean {
  const element = document.querySelector<HTMLSelectElement>(`select[data-control="${control}"]`);
  if (!element || element.disabled) return false;
  element.focus();
  try {
    element.showPicker?.();
  } catch {
    /* o foco já destaca o seletor */
  }
  return true;
}
