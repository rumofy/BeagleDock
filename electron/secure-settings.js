const SECRET_KEYS = [
  "openRouterApiKey",
  "anthropicApiKey",
  "openaiApiKey",
  "geminiApiKey",
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
    if (typeof value !== "string") throw new Error("Credencial inválida.");
    if (
      !storage?.isEncryptionAvailable() ||
      storage.getSelectedStorageBackend?.() === "basic_text"
    )
      throw new Error(
        "O cofre do sistema não está disponível. Salve chaves pelo aplicativo desktop com o cofre desbloqueado.",
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
module.exports = { protectSettings, publicSettings, SECRET_KEYS };
