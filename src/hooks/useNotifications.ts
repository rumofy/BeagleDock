import { useState } from "react";
import type { AppNotification } from "../types";
import type { UpdateInfo } from "../types/api";

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({});
  return {
    notifications,
    setNotifications,
    checkingUpdates,
    setCheckingUpdates,
    updateInfo,
    setUpdateInfo,
  };
}
