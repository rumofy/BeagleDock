/** Rascunho da mensagem por conversa: guardado ao trocar de conversa e ao fechar o app. */
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

/** Grava o mapa inteiro; falha de armazenamento (modo privado, cota) é ignorada. */
export function saveDrafts(drafts: DraftMap, storage?: DraftStorage) {
  try {
    storage?.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    /* o rascunho vale só nesta execução */
  }
}

/**
 * Devolve o novo mapa (texto vazio remove o rascunho). Com `storage`, também grava na hora; sem ele,
 * quem chama grava depois (ex.: com atraso, para não gravar a cada tecla).
 */
export function updateDraft(
  drafts: DraftMap,
  sessionId: string,
  text: string,
  storage?: DraftStorage,
): DraftMap {
  const next: DraftMap = { ...drafts };
  if (text.trim()) {
    delete next[sessionId]; // reinsere no fim: o mais recente é o último a ser descartado
    next[sessionId] = text.slice(0, MAX_LENGTH);
  } else delete next[sessionId];
  const ids = Object.keys(next);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_DRAFTS))) delete next[id];
  if (storage) saveDrafts(next, storage);
  return next;
}
