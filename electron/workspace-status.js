const fs = require("fs");
const path = require("path");
const { t } = require("./i18n");

// State of each registered workspace, read from disk on every query (the folder may have moved).
function inspectWorkspace(workspace, counts = {}, fsApi = fs) {
  let exists = false;
  try {
    exists = fsApi.statSync(workspace.path).isDirectory();
    if (exists) fsApi.accessSync(workspace.path, fs.constants.R_OK);
  } catch {
    exists = false;
  }
  return {
    ...workspace,
    exists,
    isGitRepo: exists && fsApi.existsSync(path.join(workspace.path, ".git")),
    hasAIMemory: exists && fsApi.existsSync(path.join(workspace.path, ".ai-memory.toml")),
    conversations: counts[workspace.path] || 0,
  };
}

// The name comes from the interface; the path must exist and be a folder.
function validateWorkspaceEdit({ name, path: dir }, { validCwd }) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error(t("errors.workspaceName"));
  if (cleanName.length > 80) throw new Error(t("errors.workspaceNameLength"));
  return { name: cleanName, path: validCwd(String(dir || "").trim()) };
}

module.exports = { inspectWorkspace, validateWorkspaceEdit };
