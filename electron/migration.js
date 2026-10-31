// Migração única das identidades antigas (CapyAI / Bleagle) para BeagleDock.
// Deve rodar no processo principal ANTES de qualquer acesso ao banco ou ao userData.
// Idempotente: sem o diretório antigo, ou com o novo já existente, não faz nada.
const fs = require("fs");
const path = require("path");
const os = require("os");

const LEGACY_DIR = ".capyai";
const LEGACY_DB = "capyai.db";
const NEW_DB = "beagledock.db";
const LEGACY_HOOK_ID = /^(?:capy(?:ai)?|bleagle(?:dock)?)(?:[-_.].*)?$/i;

function copyRecursive(from, to) {
  const stat = fs.lstatSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true, mode: stat.mode & 0o777 });
    for (const entry of fs.readdirSync(from))
      copyRecursive(path.join(from, entry), path.join(to, entry));
  } else if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(from), to);
  } else {
    fs.copyFileSync(from, to);
    fs.chmodSync(to, stat.mode & 0o777);
  }
}
function snapshot(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      for (const child of snapshot(full))
        result.push(path.join(entry.name, child));
    else result.push(entry.name + ":" + fs.lstatSync(full).size);
  }
  return result.sort();
}
function moveDir(from, to, { fsImpl = fs } = {}) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fsImpl.renameSync(from, to);
    return "renamed";
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
  }
  try {
    copyRecursive(from, to);
    if (JSON.stringify(snapshot(from)) !== JSON.stringify(snapshot(to)))
      throw new Error("Cópia não confere com a origem.");
  } catch (error) {
    fs.rmSync(to, { recursive: true, force: true });
    throw error;
  }
  fs.rmSync(from, { recursive: true, force: true });
  return "copied";
}
function renameDb(dir) {
  const renamed = [];
  const target = path.join(dir, NEW_DB);
  if (fs.existsSync(target)) return renamed;
  for (const suffix of ["", "-wal", "-shm"]) {
    const from = path.join(dir, LEGACY_DB + suffix);
    if (!fs.existsSync(from)) continue;
    fs.renameSync(from, path.join(dir, NEW_DB + suffix));
    renamed.push(LEGACY_DB + suffix);
  }
  return renamed;
}
function migrateDirectory(from, to, label, log) {
  if (!fs.existsSync(from)) return { status: "none" };
  if (fs.existsSync(to)) {
    log(`[migração] ${label}: ${to} já existe; ${from} foi preservado.`);
    return { status: "kept-both" };
  }
  const how = moveDir(from, to);
  log(`[migração] ${label}: ${from} -> ${to} (${how}).`);
  return { status: how };
}
function migrateLegacyData({
  home = os.homedir(),
  appData,
  env = process.env,
  log = console.log,
} = {}) {
  const result = { data: null, userData: null, db: [] };
  try {
    if (!env.BEAGLEDOCK_DATA_DIR) {
      const target = path.join(home, ".beagledock");
      result.data = migrateDirectory(
        path.join(home, LEGACY_DIR),
        target,
        "dados",
        log,
      ).status;
      if (fs.existsSync(target)) {
        result.db = renameDb(target);
        if (result.db.length)
          log(`[migração] banco renomeado para ${NEW_DB} (${result.db.join(", ")}).`);
      }
    } else if (fs.existsSync(env.BEAGLEDOCK_DATA_DIR)) {
      result.db = renameDb(env.BEAGLEDOCK_DATA_DIR);
    }
  } catch (error) {
    log(`[migração] falha nos dados: ${error.message}`);
  }
  try {
    if (appData)
      result.userData = migrateDirectory(
        path.join(appData, "capyai"),
        path.join(appData, "beagledock"),
        "userData",
        log,
      ).status;
  } catch (error) {
    log(`[migração] falha no userData: ${error.message}`);
  }
  return result;
}
// Remove entradas de hook de aprovação das identidades antigas, preservando as demais.
function removeLegacyHooks(hooks) {
  const removed = [];
  for (const key of Object.keys(hooks))
    if (LEGACY_HOOK_ID.test(key)) {
      delete hooks[key];
      removed.push(key);
    }
  return removed;
}
module.exports = {
  migrateLegacyData,
  removeLegacyHooks,
  renameDb,
  moveDir,
  LEGACY_HOOK_ID,
};
