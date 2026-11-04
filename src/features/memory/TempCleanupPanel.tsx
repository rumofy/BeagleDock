import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useTempCleanup } from "./useTempCleanup";

import { t, tn } from "../../i18n";
/**
 * Cleanup of ai-memory's temporary projects: the age in days for the automatic cleanup
 * and a button to delete them all now. Only projects whose sessions all came from temporary
 * folders (real-CLI tests) count; real projects never show up here.
 */
export function TempCleanupPanel({ onCleaned }: { onCleaned: () => void }) {
  const cleanup = useTempCleanup(onCleaned);
  const [confirming, setConfirming] = useState(false);
  const count = cleanup.temps.length;
  const names = cleanup.temps.map((x) => x.project).join(", ");

  return (
    <div className="p-2.5 border-t border-[#eeeae0] space-y-1.5 text-[11px] text-[#4f493e]">
      <div className="font-bold text-[#1c1b18]">{t("temp.title")}</div>
      <label className="flex items-center gap-1.5">
        <span className="flex-1">{t("temp.deleteIdle")}</span>
        <input
          type="number"
          min={0}
          max={365}
          value={cleanup.draft}
          disabled={cleanup.busy || cleanup.days === null}
          onChange={(e) => cleanup.setDraft(e.target.value)}
          onBlur={() => void cleanup.saveDays()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void cleanup.saveDays();
          }}
          aria-label={t("temp.daysLabel")}
          className="w-12 px-1.5 py-0.5 rounded-lg border border-[#dfdacd] bg-white text-right"
        />
        <span>{t("temp.days")}</span>
      </label>
      <div className="text-[10px] text-[#8c8270]">
        {cleanup.days === 0
          ? t("temp.autoOff")
          : t("temp.autoHint")}
      </div>
      {confirming ? (
        <div className="space-y-1.5 rounded-lg border border-rose-200 bg-rose-50 p-2">
          <div className="text-rose-900">
            {tn("temp.confirm", count)}
          </div>
          <div className="text-[10px] text-rose-800 break-words max-h-16 overflow-y-auto">
            {names}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                setConfirming(false);
                void cleanup.cleanNow();
              }}
              className="px-2 py-1 rounded-lg font-bold bg-rose-600 hover:bg-rose-700 text-white"
            >
              {t("temp.delete")}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-2 py-1 rounded-lg font-bold bg-[#ede9de] hover:bg-[#e2dcce]"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          disabled={cleanup.busy || cleanup.loading || !count}
          title={count ? names : t("temp.none")}
          className="w-full px-2 py-1 rounded-lg font-bold bg-[#f4f1e8] hover:bg-[#eae4d5] border border-[#dfdacd] text-[#332f28] flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <Trash2 size={12} />
          {cleanup.busy
            ? t("temp.cleaning")
            : cleanup.loading
              ? t("news.checking")
              : t("temp.cleanNow", { count })}
        </button>
      )}
      {cleanup.message && <div className="text-emerald-800">{cleanup.message}</div>}
      {cleanup.error && <div className="text-rose-800">{cleanup.error}</div>}
    </div>
  );
}
