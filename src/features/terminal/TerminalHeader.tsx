import {
  Terminal,
} from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";

import { t, tn } from "../../i18n";
export function TerminalHeader() {
  const {
    setActiveTab,
    currentSession,
    cliTerminals,
  } = useApp();
  const open = Object.keys(cliTerminals.terminals).length;
  return (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-[#1c1b18] text-white">
                  <Terminal size={20} />
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1c1b18]">
                    {open
                      ? tn("terminalHeader.open", open)
                      : t("terminalHeader.pty", { cwd: currentSession?.cwd })}
                  </div>
                  <div className="text-[11px] text-[#7e7565]">
                    {open
                      ? t("terminalHeader.openHint")
                      : t("terminalHeader.ptyHint")}
                  </div>
                </div>
              </div>

              <button
                onClick={() => setActiveTab("chat")}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] text-[#36322b] transition"
              >
                {t("settingsHeader.back")}
              </button>
            </div>
  );
}
