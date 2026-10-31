// Regras puras de proteção do ai-memory (sem I/O). Fonte única usada pelo processo principal
// (via require) e pelo renderer (via import do Vite).
export const NEVER_DELETE_PREFIXES = ["decisions/"];
export const MERGE_FIRST_PREFIXES = [
  "_rules/",
  "review/",
  "claude-memory/",
  "procedures/",
  "profile/",
  "preferences/",
  "_prompts/",
];
export const PROTECTED_PREFIXES = [
  ...NEVER_DELETE_PREFIXES,
  ...MERGE_FIRST_PREFIXES,
];

export function protectionFor(pagePath) {
  const p = String(pagePath || "");
  if (NEVER_DELETE_PREFIXES.some((x) => p.startsWith(x))) return "never";
  if (MERGE_FIRST_PREFIXES.some((x) => p.startsWith(x))) return "merge";
  return "none";
}

export function isTestProject(name) {
  return /probe|canary/i.test(String(name || ""));
}

export function canPurgeProject(workspace, project) {
  const ws = String(workspace || "");
  const p = String(project || "");
  if (!ws || !p) return false;
  if (ws === "_global" || p === "_global") return false;
  if (ws.startsWith("_") || p.startsWith("_")) return false;
  return true;
}

// Exclusão de páginas protegidas exige confirmação explícita igual ao caminho da página.
export function deleteConfirmationError(pagePath, confirmProtected) {
  if (protectionFor(pagePath) === "none") return null;
  if (typeof confirmProtected === "string" && confirmProtected === pagePath)
    return null;
  return "Página protegida: confirme a exclusão informando o caminho da página.";
}
