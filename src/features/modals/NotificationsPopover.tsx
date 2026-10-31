import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  Sparkle,
} from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import { beagleApi } from "../../api/beagleApi";

export function NotificationsPopover() {
  const {
    setAppError,
    notifications,
    setNotifications,
    checkingUpdates,
    setCheckingUpdates,
    updateInfo,
    setUpdateInfo,
  } = useApp();
  const [showNotifications, setShowNotifications] = useState<boolean>(false);
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);
  const [notificationsPosition, setNotificationsPosition] = useState({
    left: 12,
    top: 80,
    maxHeight: 480,
  });
  useLayoutEffect(() => {
    if (!showNotifications) return;
    const place = () => {
      const anchor = notificationsButtonRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(320, window.innerWidth - 24);
      const top = Math.max(
        12,
        Math.min(anchor.bottom + 8, window.innerHeight - 160),
      );
      setNotificationsPosition({
        left: Math.max(
          12,
          Math.min(anchor.right - width, window.innerWidth - width - 12),
        ),
        top,
        maxHeight: window.innerHeight - top - 12,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [showNotifications]);
  return (
            <div className="relative">
              <button
                onClick={() => {
                  setShowNotifications((prev) => !prev);
                  if (!showNotifications)
                    void beagleApi.readNotifications()
                      .then((r: any) => setNotifications(r.notifications || []))
                      .catch((e: Error) => setAppError(e.message));
                }}
                className={`p-2 rounded-xl transition relative ${
                  showNotifications
                    ? "bg-[#dfdacd] text-[#1c1b18]"
                    : "text-[#6d6657] hover:bg-[#e4dec9] hover:text-[#1c1b18]"
                }`}
                ref={notificationsButtonRef}
                aria-expanded={showNotifications}
                aria-controls="ecosystem-notifications"
                title="Novidades de CLIs, novos modelos e ai-memory"
              >
                <Bell size={17} />
                {notifications.some((n) => n.isNew) && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-[#ede9de] animate-pulse" />
                )}
              </button>

              {showNotifications &&
                createPortal(
                  <div
                    id="ecosystem-notifications"
                    role="dialog"
                    aria-label="Novidades do ecossistema"
                    style={notificationsPosition}
                    className="fixed w-80 max-w-[calc(100vw-24px)] bg-[#ffffff] border border-[#d8d2c3] rounded-2xl shadow-2xl z-50 p-3 flex flex-col gap-2.5 overflow-hidden [overflow-wrap:anywhere]"
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-[#eeeae0] px-1">
                      <div className="font-bold text-xs text-[#1c1b18] flex items-center gap-1.5">
                        <Sparkle size={13} className="text-amber-600" />
                        <span>Status do Ecossistema</span>
                      </div>
                      <span className="text-[10px] font-mono bg-[#f4f1e8] text-[#7d7565] px-1.5 py-0.5 rounded">
                        {notifications.filter((n) => n.isNew).length} ativos
                      </span>
                    </div>

                    <div className="space-y-2 max-h-80 min-h-0 overflow-y-auto pr-1">
                      <button
                        className="text-xs underline disabled:opacity-50"
                        disabled={checkingUpdates}
                        onClick={async () => {
                          setCheckingUpdates(true);
                          try {
                            const r = await beagleApi.checkCliUpdates();
                            setNotifications(r.updates?.notifications || []);
                            setUpdateInfo(r.updates || {});
                          } catch (e) {
                            setAppError((e as Error).message);
                          } finally {
                            setCheckingUpdates(false);
                          }
                        }}
                      >
                        {checkingUpdates
                          ? "Verificando…"
                          : "Verificar novas versões"}
                      </button>
                      {!notifications.length && (
                        <p className="text-xs text-[#7d7565]">
                          Nenhuma novidade detectada. Novos modelos são
                          identificados ao sincronizar os catálogos das CLIs.
                        </p>
                      )}
                      {updateInfo.checkedAt && (
                        <p className="text-[10px] text-[#7d7565]">
                          Última consulta:{" "}
                          {new Date(updateInfo.checkedAt).toLocaleString()}
                        </p>
                      )}
                      {Object.entries(updateInfo.releases || {})
                        .filter(([, r]: any) => r.error)
                        .map(([id]) => (
                          <p key={id} className="text-[10px] text-amber-800">
                            {id}: consulta de versões indisponível.
                          </p>
                        ))}
                      {notifications.map((notif) => (
                        <div
                          key={notif.id}
                          className="p-2.5 rounded-xl bg-[#faf8f4] hover:bg-[#f3efe4] border border-[#ede7d8] transition text-left"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span
                              className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                notif.category === "ai_memory"
                                  ? "bg-purple-100 text-purple-800"
                                  : notif.category === "mcp_auth"
                                    ? "bg-amber-100 text-amber-800"
                                    : notif.category === "new_model"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-blue-100 text-blue-800"
                              }`}
                            >
                              {notif.category === "ai_memory"
                                ? "ai-memory"
                                : notif.category === "mcp_auth"
                                  ? "MCP"
                                  : notif.category === "new_model"
                                  ? "Novo modelo"
                                  : "CLI Status"}
                            </span>
                            <span className="text-[10px] text-[#938b7a]">
                              {notif.date}
                            </span>
                          </div>

                          <div className="font-bold text-xs text-[#221f1a]">
                            {notif.title}
                          </div>
                          {notif.models?.length ? (
                            <ul className="text-[11px] text-[#6d6657] mt-1 space-y-1">
                              {notif.models.map((model) => (
                                <li key={model.id}>
                                  <span className="font-semibold">
                                    {model.label}
                                  </span>
                                  <span className="block text-[10px] font-mono break-all">
                                    {model.id}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-[11px] text-[#6d6657] mt-0.5 leading-snug">
                              {notif.description}
                            </p>
                          )}

                          {notif.actionCommand && (
                            <div className="mt-2 pt-1.5 border-t border-[#e8e2d2] flex items-center justify-between">
                              <span className="font-mono text-[9px] text-[#7d7565] truncate max-w-[180px]">
                                $ {notif.actionCommand}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(
                                    notif.actionCommand!,
                                  );
                                }}
                                className="text-[10px] font-bold text-indigo-700 hover:text-indigo-900"
                              >
                                Copiar
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="pt-1 text-center border-t border-[#eeeae0]">
                      <button
                        onClick={() => setShowNotifications(false)}
                        className="text-[11px] font-semibold text-[#8c8270] hover:text-[#1c1b18]"
                      >
                        Fechar
                      </button>
                    </div>
                  </div>,
                  document.body,
                )}
            </div>
  );
}
