import { useState } from "react";
import type { WorkspaceItem } from "../types";

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  return { workspaces, setWorkspaces };
}
