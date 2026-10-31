import { useApp } from "../../hooks/AppStateProvider";
import { ApprovalCard } from "../../components/ApprovalCard";

export function ApprovalPrompt() {
  const {
    activeTab,
    setActiveTab,
    cliApprovals,
    resolveApproval,
    activeSessionId,
    setActiveSessionId,
    allSessions,
    maintenanceSessionId,
  } = useApp();
  // O que já aparece no chat aberto, ou na Manutenção, não repete no aviso global.
  const pending = cliApprovals.filter(
    (a) =>
      !(activeTab === "memory" && a.sessionId === maintenanceSessionId) &&
      !(activeTab === "chat" && a.sessionId === activeSessionId),
  );
  if (pending.length === 0) return null;
  const first = pending[0];
  const title =
    allSessions.find((s) => s.id === first.sessionId)?.title ||
    "Abrir conversa";
  return (
    <div
      role="dialog"
      aria-label="Permissão pendente em outra conversa"
      className="fixed bottom-6 right-6 z-[70] w-[26rem] max-w-[calc(100vw-48px)] space-y-2"
    >
      <button
        className="text-xs underline text-[#2c2822] bg-[#fcfbfa]/90 rounded px-1.5 py-0.5"
        onClick={() => {
          setActiveSessionId(first.sessionId);
          setActiveTab("chat");
        }}
      >
        {title}
        {pending.length > 1 ? ` · +${pending.length - 1} pendente(s)` : ""}
      </button>
      <ApprovalCard approval={first} onResolve={resolveApproval} compact />
    </div>
  );
}
