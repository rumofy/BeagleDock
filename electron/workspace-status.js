const fs = require("fs");
const path = require("path");

// Estado de cada workspace cadastrado, lido do disco a cada consulta (a pasta pode ter sido movida).
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

// O nome vem da interface; o caminho precisa existir e ser uma pasta.
function validateWorkspaceEdit({ name, path: dir }, { validCwd }) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Informe um nome para o workspace.");
  if (cleanName.length > 80) throw new Error("O nome do workspace pode ter até 80 caracteres.");
  return { name: cleanName, path: validCwd(String(dir || "").trim()) };
}

module.exports = { inspectWorkspace, validateWorkspaceEdit };
