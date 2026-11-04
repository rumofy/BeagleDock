import { useEffect } from "react";
import { useApp } from "../../hooks/AppStateProvider";
import {
  nextPermission,
  PERMISSION_LABELS,
  permissionShortcut,
  togglePlan,
} from "../../lib/permissionModes";

import { t } from "../../i18n";
/** Permission-mode shortcuts: Alt+P toggles plan mode and Alt+M cycles through the modes. */
export function PermissionShortcuts() {
  const { activeTab, currentSession, handlePermissionChange, setAppError } = useApp();
  useEffect(() => {
    if (activeTab !== "chat" || !currentSession) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = permissionShortcut(event);
      if (!action) return;
      event.preventDefault();
      const next =
        action === "plan" ? togglePlan(currentSession.permission, currentSession.permissionBeforePlan) : nextPermission(currentSession.permission);
      handlePermissionChange(next);
      setAppError("");
      // Discreet confirmation in the header picker, which always shows the current mode.
      document.querySelector<HTMLSelectElement>('select[data-control="permission"]')?.setAttribute(
        "title",
        t("permission.shortcutNotice", { mode: PERMISSION_LABELS[next] }),
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, currentSession, handlePermissionChange, setAppError]);
  return null;
}
