// Texto das notificações de fim de resposta (chat e modo terminal), no mesmo formato para as três CLIs.
const { plainText } = require("./message-segments");

const PROVIDER_LABELS = { claude: "Claude Code", codex: "Codex CLI", antigravity: "Antigravity" };
const label = (providerId) => PROVIDER_LABELS[providerId] || providerId || "CLI";
const short = (text) => plainText(String(text ?? "")).replace(/\s+/g, " ").trim().slice(0, 140);

/**
 * Chat: a resposta que você pediu terminou ou falhou. Mensagem entregue no meio de outra resposta,
 * cancelada ou parada por você não avisa (quem avisa é o fim da resposta em andamento).
 */
function chatReplyNotice(providerId, result) {
  if (!result || result.injected || result.cancelled || result.stopped || result.discarded) return null;
  const name = label(providerId);
  const last = result.followUps?.length ? result.followUps.at(-1).text : "";
  return result.ok
    ? { title: `${name} respondeu`, body: short(last || result.output) || "Execução concluída." }
    : { title: `${name} · a resposta falhou`, body: short(result.error) || "Falha na execução." };
}

/** Modo terminal: a CLI terminou a resposta ou parou esperando você (uma aprovação, por exemplo). */
function terminalTurnNotice(providerId, lastReply) {
  return {
    title: `${label(providerId)} · sua vez no terminal`,
    body: short(lastReply) || "A resposta terminou ou a CLI espera você.",
  };
}

module.exports = { chatReplyNotice, terminalTurnNotice, PROVIDER_LABELS };
