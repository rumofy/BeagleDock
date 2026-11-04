import { AlertTriangle } from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import { formatIdle } from "../../lib/staleContext";
import { formatTokens } from "../../lib/tokens";

import { t } from "../../i18n";
const modelName = (model: string) => model || t("stale.cliDefault");

/**
 * Warning before sending in a large conversation whose whole context would be reprocessed: the
 * cache expired (idle conversation) and/or the model was switched (the cache is per model).
 */
export function StaleContextNotice() {
  const { staleNotice, resolveStaleNotice, activeSessionId } = useApp();
  if (!staleNotice || staleNotice.session.id !== activeSessionId) return null;
  const { used, idleMs, switched } = staleNotice;
  const tokens = formatTokens(used);
  const button = "px-3 py-1.5 rounded-lg border font-bold disabled:opacity-40";
  const title = switched
    ? idleMs !== undefined
      ? t("stale.titleSwitchedIdle", { idle: formatIdle(idleMs), tokens })
      : t("stale.titleSwitched", { tokens })
    : t("stale.titleIdle", { idle: formatIdle(idleMs ?? 0), tokens });
  return (
    <div
      role="alertdialog"
      aria-label={switched ? t("stale.labelSwitched") : t("stale.labelIdle")}
      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950"
      data-testid="stale-context-notice"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="font-bold">{title}</p>
          {switched ? (
            <p>
              {t("stale.switchedBody", { model: modelName(switched.to), tokens })}
              {idleMs === undefined
                ? ` ${t("stale.switchedBack", { model: modelName(switched.from) })}`
                : ""}{" "}
              {t("stale.switchedCompact", { model: modelName(switched.from) })}
            </p>
          ) : (
            <p>
              {t("stale.idleBody", { tokens })}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void resolveStaleNotice("send")}
          className={`${button} border-amber-400 bg-white hover:bg-amber-100`}
        >
          {t("stale.sendAnyway")}
        </button>
        {switched && idleMs === undefined && (
          <button
            type="button"
            onClick={() => void resolveStaleNotice("previous")}
            className={`${button} border-amber-400 bg-white hover:bg-amber-100`}
          >
            {t("stale.sendWith", { model: modelName(switched.from) })}
          </button>
        )}
        <button
          type="button"
          onClick={() => void resolveStaleNotice("compact")}
          className={`${button} border-amber-600 bg-amber-600 text-white hover:bg-amber-700`}
        >
          {t("stale.compactAndSend")}
        </button>
        <button
          type="button"
          onClick={() => void resolveStaleNotice("cancel")}
          className={`${button} border-transparent text-amber-900 hover:underline`}
        >
          {t("stale.backToEdit")}
        </button>
      </div>
    </div>
  );
}
