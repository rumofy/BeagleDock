import { MemoryExplorerProvider } from "./MemoryExplorerContext";
import { DeletePageDialog } from "./DeletePageDialog";
import { MaintenanceHost } from "./MaintenanceHost";
import { PageBrowser } from "./PageBrowser";
import { PageReader } from "./PageReader";
import { ProjectList } from "./ProjectList";
import { PurgeProjectDialog } from "./PurgeProjectDialog";
import { useMemoryExplorer } from "./useMemoryExplorer";
import type { MemoryExplorerProps } from "./useMemoryExplorer";

export type { MemoryExplorerProps } from "./useMemoryExplorer";

export function MemoryExplorer(props: MemoryExplorerProps) {
  const state = useMemoryExplorer(props);
  return (
    <MemoryExplorerProvider value={state}>
      <div className="flex-1 min-h-0 flex bg-[#fcfbfa]" data-testid="memory-explorer">
        <ProjectList />
        <PageBrowser />
        <PageReader />
        <DeletePageDialog />
        <PurgeProjectDialog />
        <MaintenanceHost />
      </div>
    </MemoryExplorerProvider>
  );
}
