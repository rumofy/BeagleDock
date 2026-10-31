import { useEffect, useState } from "react";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import type { HistorySessionItem, SkillItem } from "../types";

export function useSkillsHistory() {
  const [installedSkills, setInstalledSkills] = useState<SkillItem[]>([]);
  const [cliHistory, setCliHistory] = useState<HistorySessionItem[]>([]);
  // Skills e Histórico de Sessões (carga inicial + atualização periódica)
  useEffect(() => {
    if (!backendAvailable()) return;
    beagleApi
      .getInstalledSkills()
      .then((skills) => {
        setInstalledSkills(skills || []);
      })
      .catch(() => {});
    beagleApi
      .getCliHistory()
      .then((history) => {
        setCliHistory(history || []);
      })
      .catch(() => {});
    const historyTimer = window.setInterval(() => {
      beagleApi
        .getCliHistory()
        .then((items) => setCliHistory(items || []))
        .catch(() => {});
      beagleApi
        .getInstalledSkills()
        .then((items) => setInstalledSkills(items || []))
        .catch(() => {});
    }, 30000);
    return () => clearInterval(historyTimer);
  }, []);
  return { installedSkills, cliHistory };
}
