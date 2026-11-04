import { createContext, useContext } from "react";
import type { MemoryExplorerState } from "./useMemoryExplorer";

const MemoryExplorerContext = createContext<MemoryExplorerState | null>(null);
export const MemoryExplorerProvider = MemoryExplorerContext.Provider;

export function useMemoryExplorerState(): MemoryExplorerState {
  const value = useContext(MemoryExplorerContext);
  if (!value)
    throw new Error("useMemoryExplorerState must be used inside MemoryExplorerProvider.");
  return value;
}
