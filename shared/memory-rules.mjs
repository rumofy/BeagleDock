// Pure ai-memory protection rules (no I/O). Single source used by the main process
// (via require) and by the renderer (via Vite import).
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

// Deleting protected pages requires an explicit confirmation equal to the page path.
export function deleteConfirmationError(pagePath, confirmProtected) {
  if (protectionFor(pagePath) === "none") return null;
  if (typeof confirmProtected === "string" && confirmProtected === pagePath)
    return null;
  return "Protected page: confirm the deletion by entering the page path.";
}
