import { memo } from "react";
import { ListChecks } from "lucide-react";
import { MessageBody } from "./MessageBody";
import type { FileTarget } from "./LinkedText";
import type { ChatEvent } from "../types";

import { t } from "../i18n";
/** The latest plan the AI proposed in this reply (Claude Code ExitPlanMode, Codex plan mode). */
export function proposedPlan(events: ChatEvent[] | undefined) {
  return [...(events || [])].reverse().find((e) => e.meta?.proposal && e.text?.trim());
}

/**
 * The proposed plan, readable in full inside the conversation. It stays in the history after the
 * decision, so what was approved (or not) can always be checked later.
 */
export const PlanProposal = memo(function PlanProposal({
  event,
  onOpenFile,
}: {
  event: ChatEvent;
  onOpenFile?: (target: FileTarget) => void;
}) {
  return (
    <section
      data-testid="plan-proposal"
      aria-label={t("plan.proposed")}
      className="rounded-xl border border-emerald-300 bg-emerald-50/60 p-3 space-y-2"
    >
      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900">
        <ListChecks size={14} className="shrink-0" />
        {t("plan.proposed")}
      </div>
      <div className="whitespace-pre-wrap break-words font-sans text-sm max-h-[32rem] overflow-y-auto">
        <MessageBody text={event.text || ""} onOpenFile={onOpenFile} />
      </div>
    </section>
  );
});
