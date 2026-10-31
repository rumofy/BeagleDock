// Mascara segredos comuns antes de exibir ou gravar a linha do tempo (comandos, argumentos de
// ferramentas e raciocínio podem conter tokens). Heurístico: reduz o risco, não o elimina.
const MASK = "***";

const PATTERNS = [
  // Chaves privadas PEM (inclusive um bloco ainda incompleto, durante o streaming)
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, MASK],
  // Authorization: <esquema> <valor> — mascara o valor, não só o esquema
  [/(\bauthorization["']?\s*[:=]\s*["']?(?:bearer|basic|token|digest)\s+)[^\s"',;&)]+/gi, `$1${MASK}`],
  // Flags de linha de comando com o valor separado por espaço: --password segredo
  [/(--?(?:password|passwd|pwd|token|secret|api[-_]?key|access[-_]?key|auth)\s+)(?!-)[^\s"']+/gi, `$1${MASK}`],
  // Cabeçalhos e credenciais em URLs
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${MASK}`],
  [/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${MASK}@`],
  // chave: valor / chave=valor, inclusive JSON ("api_key": "...") e variáveis de ambiente
  [
    /(["']?\b[\w.-]*(?:api[-_]?key|apikey|access[-_]?key|secret|token|passw(?:or)?d|pwd|authorization|credential)[\w.-]*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s"',;&)]+)/gi,
    `$1${MASK}`,
  ],
  // Formatos conhecidos de chaves
  [/\bsk-[A-Za-z0-9_-]{16,}/g, MASK],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, MASK],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, MASK],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, MASK],
  [/\bAKIA[0-9A-Z]{16}\b/g, MASK],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, MASK],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, MASK],
];

function redact(value) {
  if (typeof value !== "string" || !value) return value;
  let text = value;
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  return text;
}

module.exports = { redact, MASK };
