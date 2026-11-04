const { t } = require("./i18n");
const SECRET_KEYS = [
  "openRouterApiKey",
  "anthropicApiKey",
  "openaiApiKey",
  "geminiApiKey",
  "transcriptionApiKey",
];
function systemStorage() {
  try {
    return require("electron").safeStorage;
  } catch {
    return undefined;
  }
}
function protectSettings(incoming, existing = {}, storage = systemStorage()) {
  const result = { ...existing, ...incoming };
  delete result.configuredSecrets;
  delete result.securityWarning;
  for (const key of SECRET_KEYS) {
    const value = Object.hasOwn(incoming, key) ? incoming[key] : existing[key];
    if (!value) {
      delete result[key];
      continue;
    }
    if (
      !Object.hasOwn(incoming, key) &&
      typeof value === "object" &&
      value.encrypted === 1
    ) {
      result[key] = value;
      continue;
    }
    if (typeof value !== "string") throw new Error(t("errors.invalidCredential"));
    if (
      !storage?.isEncryptionAvailable() ||
      storage.getSelectedStorageBackend?.() === "basic_text"
    )
      throw new Error(
        t("errors.vaultUnavailable"),
      );
    result[key] = {
      encrypted: 1,
      ciphertext: storage.encryptString(value).toString("base64"),
    };
  }
  return result;
}
function publicSettings(settings) {
  const result = { ...settings, configuredSecrets: {} };
  for (const key of SECRET_KEYS) {
    result.configuredSecrets[key] = !!settings[key];
    delete result[key];
  }
  return result;
}
// Credentials encrypted with the app's old identity may no longer be readable.
// Only the ones that fail to decrypt are removed; without a vault there's no way to tell.
function dropUnreadableSecrets(settings, storage = systemStorage()) {
  const result = { ...settings };
  const dropped = [];
  let available = false;
  try {
    available = !!storage?.isEncryptionAvailable();
  } catch {}
  if (!available) return { settings: result, dropped };
  for (const key of SECRET_KEYS) {
    const value = result[key];
    if (!value || typeof value !== "object" || value.encrypted !== 1) continue;
    try {
      storage.decryptString(Buffer.from(String(value.ciphertext), "base64"));
    } catch {
      delete result[key];
      dropped.push(key);
    }
  }
  return { settings: result, dropped };
}
// Returns the plain value of a stored credential (only for use in the main process).
function revealSecret(value, storage = systemStorage()) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value.encrypted !== 1) return "";
  if (!storage?.isEncryptionAvailable())
    throw new Error(t("errors.vaultReadUnavailable"));
  return storage.decryptString(Buffer.from(String(value.ciphertext), "base64"));
}
module.exports = {
  revealSecret,
  protectSettings,
  publicSettings,
  dropUnreadableSecrets,
  SECRET_KEYS,
};
