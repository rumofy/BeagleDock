// Quando rodando no navegador (sem Electron), conecta ao backend real via bridge HTTP do Vite.
const w = window as any;
const token = document.querySelector<HTMLMetaElement>(
  'meta[name="capy-bridge-token"]',
)?.content;
if (!w.capyAPI && (import.meta as any).env?.DEV && token) {
  const call = async (method: string, args: any[]) => {
    const res = await fetch("/__capy/invoke", {
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
    "getInstalledSkills",
    "getCliHistory",
    "loadFullConversation",
    "getUserProfile",
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
  ];
  const api: any = {};
  methods.forEach((m) => {
    api[m] = (...args: any[]) => call(m, args);
  });
  const subs = new Map<string, Set<(...a: any[]) => void>>();
  let es: EventSource | null = null;
  api.on = (channel: string, cb: (...a: any[]) => void) => {
    if (!es) {
      es = new EventSource(`/__capy/events?token=${encodeURIComponent(token)}`);
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
  w.capyAPI = api;
}
export {};
