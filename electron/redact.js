// Masks common secrets before showing or saving the timeline (commands, tool arguments
// and reasoning may contain tokens). Heuristic: it reduces the risk, it doesn't remove it.
const MASK = "***";

const PATTERNS = [
  // PEM private keys (including a still incomplete block, during streaming)
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, MASK],
  // Authorization: <scheme> <value> — masks the value, not just the scheme
  [/(\bauthorization["']?\s*[:=]\s*["']?(?:bearer|basic|token|digest)\s+)[^\s"',;&)]+/gi, `$1${MASK}`],
  // Command-line flags with the value separated by a space: --password secret
  [/(--?(?:password|passwd|pwd|token|secret|api[-_]?key|access[-_]?key|auth)\s+)(?!-)[^\s"']+/gi, `$1${MASK}`],
  // Headers and credentials in URLs
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${MASK}`],
  [/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${MASK}@`],
  // key: value / key=value, including JSON ("api_key": "...") and environment variables
  [
    /(["']?\b[\w.-]*(?:api[-_]?key|apikey|access[-_]?key|secret|token|passw(?:or)?d|pwd|authorization|credential)[\w.-]*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s"',;&)]+)/gi,
    `$1${MASK}`,
  ],
  // Known key formats
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
