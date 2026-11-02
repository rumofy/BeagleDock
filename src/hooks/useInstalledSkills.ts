import { useEffect, useState } from "react";
import { backendAvailable, beagleApi } from "../api/beagleApi";
import type { SkillItem } from "../types";

/** Skills instaladas (carga inicial + atualização periódica). O histórico carrega ao abrir o modal. */
export function useInstalledSkills() {
  const [installedSkills, setInstalledSkills] = useState<SkillItem[]>([]);
  useEffect(() => {
    if (!backendAvailable()) return;
    const load = () =>
      beagleApi
        .getInstalledSkills()
        .then((skills) => setInstalledSkills(skills || []))
        .catch(() => {});
    load();
    const timer = window.setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);
  return { installedSkills };
}
