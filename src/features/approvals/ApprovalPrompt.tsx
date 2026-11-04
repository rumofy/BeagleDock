import { useApp } from "../../hooks/AppStateProvider";
import { ApprovalCard } from "../../components/ApprovalCard";

import { t } from "../../i18n";
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
  // What already shows in the open chat, or in Maintenance, isn't repeated in the global notice.
  const pending = cliApprovals.filter(
    (a) =>
      !(activeTab === "memory" && a.sessionId === maintenanceSessionId) &&
      !(activeTab === "chat" && a.sessionId === activeSessionId),
  );
  if (pending.length === 0) return null;
  const first = pending[0];
  const title =
    allSessions.find((s) => s.id === first.sessionId)?.title ||
    t("approvalPrompt.openConversation");
  return (
    <div
      role="dialog"
      aria-label={t("approvalPrompt.label")}
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
        {pending.length > 1 ? ` · ${t("approvalPrompt.more", { count: pending.length - 1 })}` : ""}
      </button>
      {first.kind === "plan" || first.kind === "question" ? (
        // Plans and questions are reviewed inside their conversation.
        <div
          data-testid={first.kind === "question" ? "question-ready-notice" : "plan-ready-notice"}
          className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 shadow-md p-3.5 space-y-2"
        >
          <div className="text-sm font-bold text-emerald-900">
            {t(first.kind === "question" ? "question.waiting" : "approvalPrompt.planReady")}
          </div>
          <p className="text-xs text-[#2c2822]">
            {t(first.kind === "question" ? "question.openHint" : "approvalPrompt.planReadyHint")}
          </p>
          <button
            type="button"
            onClick={() => {
              setActiveSessionId(first.sessionId);
              setActiveTab("chat");
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-700 text-white hover:bg-emerald-800"
          >
            {t("approvalPrompt.review")}
          </button>
        </div>
      ) : (
        <ApprovalCard approval={first} onResolve={resolveApproval} compact />
      )}
    </div>
  );
}
