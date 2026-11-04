import {
  BrainCircuit,
  RefreshCw,
} from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";

import { t } from "../../i18n";
export function MemoryHeader() {
  const {
    setActiveTab,
    isLoadingMemory,
    refreshAIMemoryExplorer,
  } = useApp();
  return (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-[#ede9de] text-[#332f28]">
                  <BrainCircuit size={20} />
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1c1b18]">
                    {t("memoryHeader.title")}
                  </div>
                  <div className="text-[11px] text-[#7e7565]">
                    {t("memoryHeader.subtitle")}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={refreshAIMemoryExplorer}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#f4f1e8] hover:bg-[#eae4d5] border border-[#dfdacd] text-[#332f28] flex items-center gap-1.5 transition"
                >
                  <RefreshCw
                    size={13}
                    className={isLoadingMemory ? "animate-spin" : ""}
                  />
                  <span>{t("memoryHeader.sync")}</span>
                </button>
                <button
                  onClick={() => setActiveTab("chat")}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] text-[#36322b] transition"
                >
                  {t("settingsHeader.back")}
                </button>
              </div>
            </div>
  );
}
