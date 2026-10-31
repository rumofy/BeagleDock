import {
  SettingsIcon,
} from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";

export function SettingsHeader() {
  const {
    setActiveTab,
  } = useApp();
  return (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-[#ede9de] text-[#332f28]">
                  <SettingsIcon size={20} />
                </div>
                <div>
                  <div className="text-sm font-bold text-[#1c1b18]">
                    Configurações, Banco SQLite & MCPs
                  </div>
                  <div className="text-[11px] text-[#7e7565]">
                    Persistência em ~/.beagledock/beagledock.db e variáveis nativas do
                    OS
                  </div>
                </div>
              </div>

              <button
                onClick={() => setActiveTab("chat")}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] text-[#36322b] transition"
              >
                Voltar ao Chat
              </button>
            </div>
  );
}
