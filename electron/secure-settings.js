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
// Credenciais cifradas com a identidade antiga do app podem não ser mais legíveis.
// Remove apenas as que falham ao decifrar; sem cofre disponível não há como saber.
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
// Devolve o valor em claro de uma credencial guardada (só para uso no processo principal).
function revealSecret(value, storage = systemStorage()) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value.encrypted !== 1) return "";
  if (!storage?.isEncryptionAvailable())
    throw new Error("O cofre do sistema não está disponível para ler a credencial.");
  return storage.decryptString(Buffer.from(String(value.ciphertext), "base64"));
}
module.exports = {
  revealSecret,
  protectSettings,
  publicSettings,
  dropUnreadableSecrets,
  SECRET_KEYS,
};
