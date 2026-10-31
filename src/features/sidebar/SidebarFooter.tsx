import {
  SettingsIcon,
} from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";

export function SidebarFooter() {
  const {
    activeTab,
    setActiveTab,
    userProfile,
  } = useApp();
  return (
        <div className="p-3 border-t border-[#dfdacd] flex items-center justify-between bg-[#ede9de]">
          <div className="flex items-center gap-2.5 truncate">
            <div
              className="w-7 h-7 rounded-xl bg-[#262420] text-amber-200 flex items-center justify-center font-bold text-xs ring-1 ring-[#d4cdbd] shrink-0"
              title={`Usuário do Sistema Operacional: ${userProfile.fullName} (${userProfile.email})`}
            >
              {userProfile.initials || "U"}
            </div>
            <div className="truncate">
              <div className="text-xs font-bold text-[#1f1d19] leading-tight truncate">
                {userProfile.fullName}
              </div>
              <div className="text-[10px] text-[#7d7565] font-mono truncate">
                {userProfile.email}
              </div>
            </div>
          </div>

          <button
            onClick={() => setActiveTab("settings")}
            className={`p-2 rounded-xl transition shrink-0 ${
              activeTab === "settings"
                ? "bg-[#dfdacd] text-[#181715]"
                : "text-[#6d6657] hover:bg-[#e4dec9]"
            }`}
            title="Configurações, Banco SQLite & MCPs"
          >
            <SettingsIcon size={16} />
          </button>
        </div>
  );
}
