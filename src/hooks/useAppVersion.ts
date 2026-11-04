import { useEffect, useState } from "react";
import { backendAvailable, beagleApi } from "../api/beagleApi";

/** App version, read from `app.getVersion()` (single source: package.json). */
export function useAppVersion() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    if (!backendAvailable()) return;
    beagleApi
      .getAppVersion()
      .then((v) => typeof v === "string" && setVersion(v))
      .catch(() => {});
  }, []);
  return version;
}
