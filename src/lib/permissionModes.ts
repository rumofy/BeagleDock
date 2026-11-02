import type { PermissionLevel } from "../types";

/** Ordem em que o atalho percorre os modos, do mais restrito ao mais livre. */
export const PERMISSION_CYCLE: PermissionLevel[] = ["inherit", "plan", "ask", "edits", "full"];

export const PERMISSION_LABELS: Record<PermissionLevel, string> = {
  inherit: "Global da CLI",
  plan: "Somente leitura (plano)",
  ask: "Restrito",
  edits: "Aceitar edições",
  full: "Acesso total",
};

/** Próximo modo do ciclo (Alt+M); volta ao primeiro depois do último. */
export function nextPermission(current: PermissionLevel | undefined): PermissionLevel {
  const index = PERMISSION_CYCLE.indexOf(current ?? "inherit");
  return PERMISSION_CYCLE[(index + 1) % PERMISSION_CYCLE.length];
}

/** Alt+P: liga o plano; com o plano ligado, volta ao modo de execução normal (aceitar edições). */
export const togglePlan = (current: PermissionLevel | undefined): PermissionLevel =>
  current === "plan" ? "edits" : "plan";

/** Mensagem enviada pelo botão "Aprovar plano e executar", já com a conversa fora do modo plano. */
export const PLAN_APPROVED_PROMPT = "Plano aprovado. Pode implementar.";

/**
 * O botão de aprovar o plano aparece quando a conversa está no modo plano, parada, e a última
 * mensagem é uma resposta concluída da IA (o plano a aprovar). Vale para as três CLIs: no Codex e no
 * AGY o plano termina só em texto, e no Claude Code ele às vezes também pergunta por texto.
 */
export function canApprovePlan(
  permission: PermissionLevel | undefined,
  executing: boolean,
  lastMessage: { sender: string; text?: string; isStreaming?: boolean } | undefined,
): boolean {
  return (
    permission === "plan" &&
    !executing &&
    !!lastMessage &&
    lastMessage.sender !== "user" &&
    !lastMessage.isStreaming &&
    !!lastMessage.text?.trim()
  );
}

export interface ShortcutKey {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Que ação o atalho pede: `plan` (Alt+P), `cycle` (Alt+M) ou nenhuma. Alt sozinho, sem Ctrl/Meta. */
export function permissionShortcut(e: ShortcutKey): "plan" | "cycle" | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const key = e.key.toLowerCase();
  return key === "p" ? "plan" : key === "m" ? "cycle" : null;
}

export interface LivePermissionOutcome {
  ok: boolean;
  applied?: "now" | "next";
  approved?: number;
}

/**
 * Explica uma troca de permissão feita com a resposta em andamento: se a CLI já usa o novo nível ou
 * só na próxima mensagem, e quantas aprovações pendentes foram liberadas. Sem nada a explicar, null.
 */
export function livePermissionNotice(
  result: LivePermissionOutcome | undefined,
  executing: boolean,
): string | null {
  if (!result?.ok) return null;
  const approved = result.approved || 0;
  const released =
    approved === 1
      ? " 1 aprovação pendente foi liberada."
      : approved > 1
        ? ` ${approved} aprovações pendentes foram liberadas.`
        : "";
  if (!executing) return released ? released.trim() : null;
  return result.applied === "now"
    ? `Novo nível aplicado à resposta em andamento.${released}`
    : `A resposta em andamento segue com o nível anterior; o novo vale a partir da próxima mensagem.${released}`;
}
