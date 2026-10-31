import { useEffect, useState } from "react";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import type { CliApproval } from "../types/api";

export function useApprovals(setAppError: (message: string) => void) {
  const [cliApprovals, setCliApprovals] = useState<CliApproval[]>([]);
  useEffect(() => {
    if (!backendAvailable()) return;
    beagleApi
      .getCliApprovals()
      .then(setCliApprovals)
      .catch(() => {});
    return beagleApi.on("cli-approvals", setCliApprovals);
  }, []);
  const resolveApproval = async (id: string, decision: string, message?: string) => {
    try {
      await beagleApi.resolveCliApproval(id, decision, message);
    } catch (e) {
      setAppError((e as Error).message);
    }
  };
  return { cliApprovals, resolveApproval };
}
