// Network client of the phone interface: calls to the BeagleDock on the computer and its live events.
// The device token stays in this browser's storage and goes in a header, never in the address.
const TOKEN_KEY = "beagledock.remote.token";
const NAME_KEY = "beagledock.remote.device";

// Three missed heartbeats from the computer (see electron/remote-access.js).
const SILENCE_LIMIT_MS = 45000;
// Time for the computer to answer a new connection (asleep or off the network: it never does).
const CONNECT_LIMIT_MS = 10000;

export class NotPairedError extends Error {}

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const deviceName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
};
export function forget() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

async function request<T>(url: string, body: unknown, auth = true): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new NotPairedError(data.error || "Not paired");
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export async function pair(code: string, name: string) {
  const result = await request<{ ok: boolean; token?: string; deviceName?: string; error?: string }>(
    "/api/pair",
    { code, name },
    false,
  );
  if (!result.ok || !result.token) throw new Error(result.error || "Pairing failed");
  localStorage.setItem(TOKEN_KEY, result.token);
  localStorage.setItem(NAME_KEY, result.deviceName || name);
}

export async function call<T>(method: string, args: unknown[] = []): Promise<T> {
  const data = await request<{ result: T }>("/api/invoke", { method, args });
  return data.result;
}

export interface RemoteEvent {
  channel: string;
  payload: any;
}

/**
 * Live events over an authenticated stream (fetch, because EventSource can't send headers).
 * Reconnects on its own; `onConnected` runs on every (re)connection so the screen reloads what it missed.
 */
export function subscribe(
  onEvent: (event: RemoteEvent) => void,
  onState: (state: "connected" | "offline" | "unpaired") => void,
): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let retry = 1000;
  let quick = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  // The computer sends a heartbeat every 15 s: silence for longer means the connection died without
  // an error (Wi-Fi switch, computer asleep), so it's dropped and opened again at once. A connection
  // the computer never answers counts as a normal drop: offline, with the growing wait.
  const watch = (current: AbortController, open: boolean) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(
      () => {
        quick = open;
        current.abort();
      },
      open ? SILENCE_LIMIT_MS : CONNECT_LIMIT_MS,
    );
  };
  async function connect() {
    while (!stopped) {
      const current = new AbortController();
      controller = current;
      watch(current, false);
      try {
        const res = await fetch("/api/events", {
          headers: { Authorization: `Bearer ${getToken() || ""}` },
          signal: controller.signal,
          cache: "no-store",
        });
        if (res.status === 401) {
          onState("unpaired");
          return;
        }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        onState("connected");
        retry = 1000;
        watch(current, true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          watch(current, true);
          buffer += decoder.decode(value, { stream: true });
          let cut;
          while ((cut = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const data = block
              .split("\n")
              .filter((line) => line.startsWith("data: "))
              .map((line) => line.slice(6))
              .join("\n");
            if (!data) continue;
            try {
              onEvent(JSON.parse(data));
            } catch {}
          }
        }
      } catch {
        if (stopped) return;
      }
      clearTimeout(watchdog);
      if (stopped) return;
      if (quick) {
        quick = false;
        continue;
      }
      onState("offline");
      await new Promise((resolve) => setTimeout(resolve, retry));
      retry = Math.min(retry * 2, 15000);
    }
  }
  void connect();
  // Back from the background (iOS suspends connections): reconnect right away.
  const wake = () => {
    if (document.visibilityState !== "visible") return;
    quick = true;
    controller?.abort();
  };
  document.addEventListener("visibilitychange", wake);
  return () => {
    stopped = true;
    clearTimeout(watchdog);
    controller?.abort();
    document.removeEventListener("visibilitychange", wake);
  };
}
