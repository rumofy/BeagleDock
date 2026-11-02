// Correção de nomes próprios no ditado por voz (sem I/O).
//
// O Parakeet local não aceita dica de vocabulário: quando a pessoa fala "BeagleDock" ele
// escreve o que ouviu ("Bigodok", "Bigaloc"). Aqui o texto é comparado pelo som com os nomes
// conhecidos (ferramentas, projeto, termos cadastrados) e o trecho é trocado pela grafia certa.
// As regras são conservadoras: só nomes com grafia própria, sem acento (português fica
// intacto), sem começar ou terminar em artigo/preposição e com o primeiro som igual.

// Chave fonética para nomes em inglês escritos por um modelo treinado em português.
function soundKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/qu/g, "k")
    .replace(/q/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/x/g, "ks")
    .replace(/w/g, "u")
    .replace(/y/g, "i")
    .replace(/ea|ee|ie/g, "i")
    .replace(/oo|ou/g, "u")
    .replace(/h/g, "")
    .replace(/(.)\1+/g, "$1");
}
const skeleton = (key) => key[0] + key.slice(1).replace(/[aeiou]/g, "");
const isVowel = (ch) => "aeiou".includes(ch);
const sameStart = (a, b) => !!a && !!b && (a[0] === b[0] || (isVowel(a[0]) && isVowel(b[0])));
function wordMatches(word, target) {
  const a = soundKey(word);
  const b = soundKey(target);
  return sameStart(a, b) && similarity(a, b) >= 0.5;
}

function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const similarity = (a, b) => 1 - distance(a, b) / Math.max(a.length, b.length, 1);

/** Semelhança de som (0 a 1) entre o que foi transcrito e o nome. */
function soundScore(phrase, name) {
  const a = soundKey(phrase);
  const b = soundKey(name);
  if (!a || !b) return 0;
  return (similarity(a, b) + similarity(skeleton(a), skeleton(b))) / 2;
}

const MIN_SCORE = 0.7;
const MIN_KEY = 6;
const MAX_WORDS = 3;
const ACCENT = /[áàâãéêíóôõúüç]/i;
const EDGE_WORDS = new Set(
  (
    "a o e é as os um uma uns umas de da do das dos em no na nos nas ao aos à às por pra pro " +
    "para com sem que se ou mas nem eu tu ele ela nós eles elas me te lhe isso isto esse essa " +
    "este esta meu minha seu sua já não sim tá vai vou foi era ser ter tem the of and to in on"
  ).split(" "),
);

/** Nome com grafia própria (maiúscula no meio, hífen ou mais de uma palavra com maiúscula). */
function hasOwnSpelling(name) {
  const s = String(name || "");
  return /\p{Lu}/u.test(s.slice(1)) || /-/.test(s) || (/\s/.test(s) && /\p{Lu}/u.test(s));
}

/**
 * Nomes que podem ser corrigidos pelo som: grafia própria e chave longa o bastante.
 * `trusted` são os termos cadastrados pela pessoa: basta começarem com maiúscula ("Rumofy").
 */
function soundNames(names, trusted = []) {
  const out = [];
  const seen = new Set();
  const own = new Set(trusted.map((t) => String(t || "").trim()));
  for (const name of [...trusted, ...names]) {
    const clean = String(name || "").trim();
    const key = soundKey(clean);
    if (!clean || seen.has(clean.toLowerCase()) || key.length < MIN_KEY) continue;
    const spelled = hasOwnSpelling(clean) || (own.has(clean) && /^\p{Lu}/u.test(clean));
    if (ACCENT.test(clean) || !spelled) continue;
    seen.add(clean.toLowerCase());
    out.push({ name: clean, key, words: clean.split(/[\s-]+/).map((w) => w.toLowerCase()) });
  }
  return out;
}

/** Troca, no texto, trechos que soam como um dos nomes pela grafia certa do nome. */
function fixNamesBySound(text, names, trusted = []) {
  const candidates = soundNames(names, trusted);
  if (!candidates.length) return String(text || "");
  const source = String(text || "");
  const known = new Set([...names, ...trusted].map((n) => String(n || "").trim().toLowerCase()));
  // Palavras grudadas em caminho, arquivo ou variável (`~/.app`, `a_b`, `x.json`) ficam de fora.
  const tokens = [...source.matchAll(/[\p{L}\p{N}][\p{L}\p{N}']*/gu)].map((m) => ({
    word: m[0],
    start: m.index,
    glued:
      /[./_\\:`@-]/.test(source[m.index - 1] || "") ||
      /^([/_\\`@-]|\.[\p{L}\p{N}])/u.test(source.slice(m.index + m[0].length, m.index + m[0].length + 2)),
  }));
  const edits = [];
  for (let i = 0; i < tokens.length; i++) {
    let best = null;
    for (let n = 1; n <= MAX_WORDS && i + n <= tokens.length; n++) {
      const win = tokens.slice(i, i + n);
      const words = win.map((t) => t.word);
      const lower = words.map((w) => w.toLowerCase());
      if (EDGE_WORDS.has(lower[0]) || EDGE_WORDS.has(lower[n - 1])) continue;
      if (win.some((t) => t.glued)) continue;
      if (words.some((w) => ACCENT.test(w) || w.length < 2 || /\d/.test(w))) continue;
      // Só palavras separadas por espaço (sem pontuação no meio).
      const end = win[n - 1].start + win[n - 1].word.length;
      if (n > 1 && /[^\p{L}\p{N}\s']/u.test(source.slice(win[0].start, end))) continue;
      const phrase = words.join(" ");
      // O que já está escrito como um nome conhecido fica como está.
      if (known.has(phrase.toLowerCase())) continue;
      const key = soundKey(phrase);
      for (const c of candidates) {
        // Trecho que já contém outro nome conhecido (ex.: "Claude Codex") não é mexido.
        if (lower.some((w) => known.has(w) && !c.words.includes(w))) continue;
        if (Math.abs(key.length - c.key.length) > Math.max(1, Math.round(c.key.length * 0.3))) continue;
        if (!sameStart(key, c.key)) continue;
        // Mesmo número de palavras: cada uma precisa soar como a do nome ("Clod Code").
        if (n > 1 && n === c.words.length && !lower.every((w, k) => wordMatches(w, c.words[k]))) continue;
        const score = soundScore(phrase, c.name);
        if (score >= MIN_SCORE && (!best || score > best.score))
          best = { score, start: win[0].start, end, name: c.name, n };
      }
    }
    if (best) {
      edits.push(best);
      i += best.n - 1;
    }
  }
  let result = source;
  for (const e of edits.reverse()) result = result.slice(0, e.start) + e.name + result.slice(e.end);
  return result;
}

module.exports = { soundKey, soundScore, soundNames, fixNamesBySound, hasOwnSpelling, MIN_SCORE };
