const fs = require("fs");
const os = require("os");
const path = require("path");
const { t } = require("./i18n");

// Info about the folder chosen in the native picker; the path comes from the system, not from typing.
function describeDirectory(dir, fsApi = fs) {
  const stat = fsApi.statSync(dir);
  if (!stat.isDirectory()) throw new Error(t("errors.pickFolder"));
  fsApi.accessSync(dir, fs.constants.R_OK);
  return {
    path: dir,
    name: path.basename(dir) || dir,
    hasAIMemory: fsApi.existsSync(path.join(dir, ".ai-memory.toml")),
    isGitRepo: fsApi.existsSync(path.join(dir, ".git")),
  };
}

function startDirectory(candidate, fsApi = fs, home = os.homedir()) {
  try {
    if (typeof candidate === "string" && fsApi.statSync(candidate).isDirectory())
      return candidate;
  } catch {}
  return home;
}

async function pickDirectory({ dialog, window, defaultPath, title }, fsApi = fs) {
  const result = await dialog.showOpenDialog(window, {
    title: title || t("dialogs.chooseProjectFolder"),
    defaultPath: startDirectory(defaultPath, fsApi),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  return { canceled: false, ...describeDirectory(result.filePaths[0], fsApi) };
}

module.exports = { describeDirectory, startDirectory, pickDirectory };
