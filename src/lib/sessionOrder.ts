import type { ChatSession } from "../types";

/**
 * Sidebar order: most recently updated conversation first. "Updated" means a message was sent or a
 * reply started/finished (`lastMessageAt`); model or permission changes don't reshuffle the list.
 * Ties (e.g. two conversations without messages) keep their current order, since sort is stable.
 */
export function sortByLastUpdate<T extends Pick<ChatSession, "lastMessageAt">>(sessions: T[]) {
  return [...sessions].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
}
