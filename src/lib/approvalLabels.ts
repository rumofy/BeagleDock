/** Nome legível da ação que pede permissão (o Codex informa o método do protocolo). */
export function approvalTitle(tool: string): string {
  if (/commandExecution\/requestApproval$/.test(tool)) return "Executar um comando";
  if (/fileChange\/requestApproval$/.test(tool)) return "Editar arquivos";
  if (/permissions\/requestApproval$/.test(tool)) return "Permissão adicional";
  if (/requestApproval$/.test(tool)) return "Ação que exige permissão";
  return tool || "Ferramenta";
}

export const PROVIDER_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  antigravity: "Antigravity",
};
