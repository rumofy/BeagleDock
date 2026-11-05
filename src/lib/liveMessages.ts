import type { ChatMessage, ChatSession } from "../types";

/**
 * Saved history reloaded after another screen changed the conversation, merged with what this
 * screen has live. Replies still arriving that aren't saved yet stay at the end; a reply that is
 * saved keeps its live version only while the conversation is still running (`active`).
 */
export function mergeLive(saved: ChatMessage[], current: ChatMessage[] = [], active = false): ChatMessage[] {
  const live = current.filter((m) => m.isStreaming);
  if (!live.length) return saved;
  const byId = new Map(live.map((m) => [m.id, m]));
  const known = new Set(saved.map((m) => m.id));
  return [
    ...saved.map((m) => (active && byId.get(m.id)) || m),
    ...live.filter((m) => !known.has(m.id)),
  ];
}

/** Fields that only exist on this screen (live shell output, process); the rest comes from the database. */
type RuntimeField = "status" | "pid" | "ptyLog" | "ptyRaw" | "shellRaw";

/** Conversation list reloaded from the database, keeping this screen's runtime state. */
export function mergeSessions(current: ChatSession[], saved: ChatSession[]): ChatSession[] {
  const byId = new Map(current.map((s) => [s.id, s]));
  return saved.map((s) => {
    const old = byId.get(s.id);
    if (!old) return s;
    const { status: _status, pid: _pid, ptyLog: _log, ptyRaw: _raw, shellRaw: _shell, ...persisted } = s as ChatSession &
      Pick<ChatSession, RuntimeField>;
    return { ...old, ...persisted };
  });
}
