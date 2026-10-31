import { BeagleLogo } from "../../components/BeagleLogo";
import { useAppVersion } from "../../hooks/useAppVersion";
import { NotificationsPopover } from "../modals/NotificationsPopover";

export function SidebarHeader() {
  const version = useAppVersion();
  return (
          <div className="p-4 border-b border-[#dfdacd]/70 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BeagleLogo size={36} className="shadow-xs rounded-xl" />
              <div>
                <div className="font-extrabold text-lg tracking-tight flex items-center gap-1.5 leading-none">
                  BeagleDock
                  <span className="text-[9px] bg-[#d7d0bc] text-[#4d4738] font-black px-1.5 py-0.5 rounded uppercase">
                    Cockpit
                  </span>
                  {version && (
                    <span className="text-[10px] font-medium text-[#9a927f] normal-case tracking-normal">
                      v{version}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[#7d7565] mt-1">
                  Multi-CLI for Developers
                </div>
              </div>
            </div>
            <NotificationsPopover />
          </div>
  );
}
