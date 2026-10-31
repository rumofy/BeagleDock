// O endereço vem de texto da IA: só abre http(s) simples no navegador padrão do sistema.
function parseExternalUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Endereço inválido.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Só é possível abrir endereços http ou https.");
  if (url.username || url.password)
    throw new Error("Endereços com usuário ou senha não são abertos.");
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
