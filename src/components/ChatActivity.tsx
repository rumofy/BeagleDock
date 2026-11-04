import { useNow } from "../hooks/useNow";
import { formatDuration } from "../lib/duration";

import { t } from "../i18n";
const WARN_AFTER_MS = 30000;

export function ChatActivity({
  text,
  detail,
  startedAt,
  activitySince,
  lastEventAt,
  lastProgressAt,
}: {
  text?: string;
  detail?: string;
  startedAt?: number;
  activitySince?: number;
  lastEventAt?: number;
  lastProgressAt?: number;
}) {
  const now = useNow(true);
  const total = Math.max(0, now - (startedAt || now));
  const inActivity = Math.max(0, now - (activitySince || startedAt || now));
  const eventAge = Math.max(0, now - (lastEventAt || startedAt || now));
  const progressAge = Math.max(0, now - (lastProgressAt || startedAt || now));
  const stalled = progressAge >= WARN_AFTER_MS;
  // Informational only: the app never interrupts or resends anything on its own.
  const liveness =
    eventAge >= WARN_AFTER_MS
      ? t("activity.noEvents", { duration: formatDuration(eventAge) })
      : stalled
        ? t("activity.noProgress", { duration: formatDuration(progressAge) })
        : t("activity.lastEvent", { duration: formatDuration(eventAge) });
  return (
    <div
      role="status"
      data-testid="chat-activity"
      className="pt-2 space-y-0.5 min-w-0"
    >
      <div className="h-4 leading-4 text-[11px] text-[#7d7565] flex items-center gap-2 min-w-0">
        <span
          className={`w-1.5 h-1.5 shrink-0 rounded-full animate-pulse ${stalled ? "bg-rose-500" : "bg-amber-500"}`}
        />
        <span
          className="font-medium truncate min-w-0 flex-1"
          title={text || t("activity.waitingCli")}
        >
          {text || t("activity.waitingCli")}
        </span>
        <span
          className={`font-mono tabular-nums shrink-0 text-[#938b7a] ${text && inActivity >= 2000 ? "" : "invisible"}`}
        >
          {t("activity.since", { duration: formatDuration(inActivity) })}
        </span>
        <span className="font-mono tabular-nums shrink-0">
          {Math.floor(total / 60000)}:
          {String(Math.floor(total / 1000) % 60).padStart(2, "0")}
        </span>
      </div>
      <div
        className={`h-4 leading-4 truncate font-mono tabular-nums text-[10px] ${stalled ? "text-rose-700" : "text-[#938b7a]"}`}
        data-testid="chat-liveness"
        title={liveness}
      >
        {liveness}
      </div>
      <div
        className="h-4 leading-4 text-[11px] font-mono text-[#8c8270] truncate"
        title={detail}
      >
        {detail}
      </div>
    </div>
  );
}
