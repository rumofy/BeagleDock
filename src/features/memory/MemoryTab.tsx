import { useApp } from "../../hooks/AppStateProvider";
import { MemoryExplorer } from "./MemoryExplorer";

export function MemoryTab() {
  const {
    providers,
    userProfile,
    memoryStatus,
    refreshAIMemoryExplorer,
    maintenanceChat,
    handleStartMaintenance,
  } = useApp();
  return (
            <MemoryExplorer
              providers={providers}
              memoryStatus={memoryStatus}
              userProfile={userProfile}
              onRefreshStatus={refreshAIMemoryExplorer}
              onStartMaintenance={handleStartMaintenance}
              chat={maintenanceChat}
            />
  );
}
