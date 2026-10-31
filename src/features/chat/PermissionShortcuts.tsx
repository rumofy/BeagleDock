import { useEffect } from "react";
import { useApp } from "../../hooks/AppStateProvider";
import {
  nextPermission,
  PERMISSION_LABELS,
  permissionShortcut,
  togglePlan,
} from "../../lib/permissionModes";

/** Atalhos do modo de permissão da conversa: Alt+P liga/desliga o plano e Alt+M percorre os modos. */
export function PermissionShortcuts() {
  const { activeTab, currentSession, handlePermissionChange, isExecutingPrompt, setAppError } = useApp();
  useEffect(() => {
    if (activeTab !== "chat" || !currentSession) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = permissionShortcut(event);
      if (!action) return;
      event.preventDefault();
      // Vale para a próxima execução: com uma resposta em andamento, o modo não muda.
      if (isExecutingPrompt) {
        setAppError("O modo de permissão muda para a próxima execução; aguarde a resposta atual terminar.");
        return;
      }
      const next =
        action === "plan" ? togglePlan(currentSession.permission) : nextPermission(currentSession.permission);
      handlePermissionChange(next);
      setAppError("");
      // Confirmação discreta no seletor do cabeçalho, que sempre mostra o modo atual.
      document.querySelector<HTMLSelectElement>('select[data-control="permission"]')?.setAttribute(
        "title",
        `Modo: ${PERMISSION_LABELS[next]} (Alt+P plano · Alt+M troca de modo)`,
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, currentSession, handlePermissionChange, isExecutingPrompt, setAppError]);
  return null;
}
