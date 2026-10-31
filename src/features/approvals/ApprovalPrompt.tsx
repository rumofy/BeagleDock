import { useApp } from "../../hooks/AppStateProvider";
import { beagleApi } from "../../api/beagleApi";

export function ApprovalPrompt() {
  const {
    activeTab,
    setActiveTab,
    setAppError,
    cliApprovals,
    setActiveSessionId,
    allSessions,
    maintenanceSessionId,
  } = useApp();
  const globalApprovals = cliApprovals.filter(
    (a) => !(activeTab === "memory" && a.sessionId === maintenanceSessionId),
  );

  if (globalApprovals.length === 0) return null;

  return (
        <div
          role="dialog"
          aria-label="Autorizar ação da CLI"
          className="fixed bottom-6 right-6 z-[70] w-96 max-w-[calc(100vw-48px)] bg-white border border-amber-300 rounded-2xl shadow-2xl p-4 space-y-3"
        >
          <div className="font-bold text-sm">
            Permissão · {globalApprovals[0].providerId}
          </div>
          <button
            className="text-xs underline"
            onClick={() => {
              setActiveSessionId(globalApprovals[0].sessionId);
              setActiveTab("chat");
            }}
          >
            {allSessions.find((s) => s.id === globalApprovals[0].sessionId)
              ?.title || "Abrir conversa"}
          </button>
          <p className="text-xs">{globalApprovals[0].tool}</p>
          <pre className="text-[11px] whitespace-pre-wrap break-all max-h-48 overflow-auto bg-[#f7f5ef] p-2 rounded-lg">
            {globalApprovals[0].input}
          </pre>
          <p className="text-[11px] text-[#7d7565]">
            A autorização vale somente para esta ação. Regras explícitas de
            bloqueio continuam valendo.
          </p>
          <div className="flex gap-2">
            {(["allow", "deny"] as const).map((decision) => (
              <button
                key={decision}
                className={`px-3 py-2 rounded-lg text-xs font-bold ${decision === "allow" ? "bg-emerald-700 text-white" : "bg-[#ede9de]"}`}
                onClick={async () => {
                  try {
                    await beagleApi.resolveCliApproval(
                      globalApprovals[0].id,
                      decision,
                    );
                  } catch (e) {
                    setAppError((e as Error).message);
                  }
                }}
              >
                {decision === "allow" ? "Autorizar uma vez" : "Negar"}
              </button>
            ))}
          </div>
        </div>
  );
}
