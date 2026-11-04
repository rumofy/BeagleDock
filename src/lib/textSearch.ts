// Conversation text search (Ctrl+F): case- and accent-insensitive, returning positions in the
// original text so the highlight lands exactly on what is on screen.

/** Comparable form of a character: lowercase and without accents ("Ç" → "c"). */
function foldChar(ch: string): string {
  return ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Folded text and the original index of each folded character. A character may become several
 * ("ß" → "ss") or none (a lone accent); the map keeps the highlight aligned with the original text.
 */
export function foldText(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) map.push(i);
    folded += f;
    i += ch.length;
  }
  map.push(i);
  return { folded, map };
}

export type TextMatch = { start: number; end: number };

/** Non-overlapping occurrences of `query` in `text`, as [start, end) ranges of the original text. */
export function findMatches(text: string, query: string): TextMatch[] {
  const needle = foldText(query.trim()).folded;
  if (!needle) return [];
  const { folded, map } = foldText(text);
  const matches: TextMatch[] = [];
  let from = 0;
  for (;;) {
    const at = folded.indexOf(needle, from);
    if (at < 0) break;
    const start = map[at];
    // End: start of the character after the last match, to cover the whole original character.
    let endIdx = at + needle.length;
    while (endIdx < map.length - 1 && map[endIdx] === map[endIdx - 1]) endIdx++;
    matches.push({ start, end: map[endIdx] });
    from = at + needle.length;
  }
  return matches;
}

/** Next index when navigating (Enter/Shift+Enter), wrapping around at the ends. */
export function stepMatch(current: number, total: number, delta: number): number {
  if (total <= 0) return -1;
  if (current < 0) return delta < 0 ? total - 1 : 0;
  return (((current + delta) % total) + total) % total;
}
