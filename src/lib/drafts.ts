/** Message draft per conversation: kept when switching conversations and when closing the app. */
export const DRAFTS_KEY = "beagledock.drafts.v1";
const MAX_DRAFTS = 60;
const MAX_LENGTH = 20000;

export type DraftMap = Record<string, string>;
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadDrafts(storage?: DraftStorage): DraftMap {
  try {
    const raw = storage?.getItem(DRAFTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const drafts: DraftMap = {};
    for (const [id, text] of Object.entries(parsed))
      if (typeof text === "string" && text.trim()) drafts[id] = text.slice(0, MAX_LENGTH);
    return drafts;
  } catch {
    return {};
  }
}

/** Writes the whole map; a storage failure (private mode, quota) is ignored. */
export function saveDrafts(drafts: DraftMap, storage?: DraftStorage) {
  try {
    storage?.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    /* the draft lasts only for this run */
  }
}

/**
 * Returns the new map (empty text removes the draft). With `storage` it also writes right away;
 * without it the caller writes later (e.g. debounced, so it doesn't write on every key).
 */
export function updateDraft(
  drafts: DraftMap,
  sessionId: string,
  text: string,
  storage?: DraftStorage,
): DraftMap {
  const next: DraftMap = { ...drafts };
  if (text.trim()) {
    delete next[sessionId]; // re-insert at the end: the most recent is the last to be dropped
    next[sessionId] = text.slice(0, MAX_LENGTH);
  } else delete next[sessionId];
  const ids = Object.keys(next);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_DRAFTS))) delete next[id];
  if (storage) saveDrafts(next, storage);
  return next;
}
