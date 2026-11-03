// Quando rodando no navegador (sem Electron), conecta ao backend real via bridge HTTP do Vite.
const w = window as unknown as { beagleAPI?: unknown };
const token = document.querySelector<HTMLMetaElement>(
  'meta[name="beagledock-bridge-token"]',
)?.content;
if (!w.beagleAPI && import.meta.env.DEV && token) {
  const call = async (method: string, args: unknown[]) => {
    const res = await fetch("/__beagledock/invoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ method, args }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha na bridge");
    return data.result;
  };
  const methods = [
    "detectTools",
    "getCliApprovals",
    "resolveCliApproval",
    "getGlobalPermissions",
    "saveGlobalPermissions",
    "checkCliUpdates",
    "readNotifications",
    "updateCli",
    "getAIMemoryStatus",
    "searchAIMemory",
    "listAIMemoryPages",
    "readAIMemoryPage",
    "runAIMemoryCommand",
    "getAIMemoryScope",
    "listAIMemoryProjects",
    "listAIMemoryProjectPages",
    "getAIMemoryProjectOverview",
    "listAIMemoryProjectSessions",
    "getAIMemoryMaintenancePrompt",
    "getAIMemoryMaintenanceCwd",
    "getInstalledSkills",
    "getCliHistory",
    "deleteConversation",
    "loadFullConversation",
    "getUserProfile",
    "getAppVersion",
    "getSavedState",
    "saveSession",
    "deleteSession",
    "saveWorkspace",
    "saveAppSettings",
    "replaceChatMessages",
    "saveChatMessage",
    "getChatMessages",
    "ptySpawn",
    "ptyWrite",
    "ptyResize",
    "executeCliPrompt",
    "interruptCliSession",
    "cancelQueuedPrompt",
    "forceQueuedPrompt",
    "answerNowPrompt",
  ];
  const api: Record<string, unknown> = {};
  methods.forEach((m) => {
    api[m] = (...args: unknown[]) => call(m, args);
  });
  const subs = new Map<string, Set<(payload: unknown) => void>>();
  let es: EventSource | null = null;
  api.on = (channel: string, cb: (payload: unknown) => void) => {
    if (!es) {
      es = new EventSource(`/__beagledock/events?token=${encodeURIComponent(token)}`);
      es.onmessage = (ev) => {
        try {
          const { channel: ch, payload } = JSON.parse(ev.data);
          subs.get(ch)?.forEach((fn) => fn(payload));
        } catch {}
      };
    }
    if (!subs.has(channel)) subs.set(channel, new Set());
    subs.get(channel)!.add(cb);
    return () => {
      subs.get(channel)?.delete(cb);
      if (![...subs.values()].some((set) => set.size)) {
        es?.close();
        es = null;
      }
    };
  };
  w.beagleAPI = api;
}
export {};
