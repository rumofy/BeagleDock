const { t } = require("./i18n");
// The address comes from AI text: only plain http(s) opens, in the system's default browser.
function parseExternalUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error(t("errors.invalidAddress"));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(t("errors.httpOnly"));
  if (url.username || url.password)
    throw new Error(t("errors.credentialsInUrl"));
  return url.href;
}

async function openExternalUrl(value, shell) {
  try {
    await shell.openExternal(parseExternalUrl(value));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { parseExternalUrl, openExternalUrl };
