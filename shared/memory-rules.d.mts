export const NEVER_DELETE_PREFIXES: string[];
export const MERGE_FIRST_PREFIXES: string[];
export const PROTECTED_PREFIXES: string[];
export function protectionFor(pagePath: string): "never" | "merge" | "none";
export function isTestProject(name: string): boolean;
export function canPurgeProject(workspace: string, project: string): boolean;
export function deleteConfirmationError(
  pagePath: string,
  confirmProtected?: string,
): string | null;
