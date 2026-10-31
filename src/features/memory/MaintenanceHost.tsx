import { useMemoryExplorerState } from "./MemoryExplorerContext";
import { MaintenanceDialog } from "./MaintenanceDialog";

export function MaintenanceHost() {
  const {
    providers,
    onStartMaintenance,
    sel,
    setRightTab,
    maintOpen,
    setMaintOpen,
    maintTarget,
  } = useMemoryExplorerState();
  if (!(maintOpen && sel)) return null;

  return (
        <MaintenanceDialog
          sel={sel}
          providers={providers}
          onClose={() => setMaintOpen(false)}
          onStart={async (args) => {
            maintTarget.current = sel;
            const id = await onStartMaintenance({
              ...args,
              title: `Manutenção ai-memory · ${sel.ws}/${sel.p}`,
            });
            if (id) {
              setMaintOpen(false);
              setRightTab("chat");
            }
            return !!id;
          }}
        />
  );
}
