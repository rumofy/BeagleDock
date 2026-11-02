// Busca de texto da conversa (Ctrl+F): sem diferenciar maiúsculas nem acentos, devolvendo posições
// no texto original para o realce cair exatamente sobre o que está na tela.

/** Forma comparável de um caractere: minúsculo e sem acento ("Ç" → "c"). */
function foldChar(ch: string): string {
  return ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Texto dobrado e o índice original de cada caractere dobrado. Um caractere pode virar mais de um
 * ("ß" → "ss") ou nenhum (acento solto); o mapa mantém o realce alinhado ao texto original.
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

/** Ocorrências de `query` em `text`, sem sobreposição, como intervalos [start, end) do texto original. */
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
    // Fim: início do caractere seguinte ao último casado, para cobrir o caractere original inteiro.
    let endIdx = at + needle.length;
    while (endIdx < map.length - 1 && map[endIdx] === map[endIdx - 1]) endIdx++;
    matches.push({ start, end: map[endIdx] });
    from = at + needle.length;
  }
  return matches;
}

/** Próximo índice ao navegar (Enter/Shift+Enter), dando a volta nas pontas. */
export function stepMatch(current: number, total: number, delta: number): number {
  if (total <= 0) return -1;
  if (current < 0) return delta < 0 ? total - 1 : 0;
  return (((current + delta) % total) + total) % total;
}
