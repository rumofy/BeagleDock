// Text of the end-of-reply notifications (chat and terminal mode), in the same format for the three CLIs.
const { plainText } = require("./message-segments");
const { t } = require("./i18n");

const PROVIDER_LABELS = { claude: "Claude Code", codex: "Codex CLI", antigravity: "Antigravity" };
const label = (providerId) => PROVIDER_LABELS[providerId] || providerId || "CLI";
const short = (text) => plainText(String(text ?? "")).replace(/\s+/g, " ").trim().slice(0, 140);

/**
 * Chat: the reply you asked for finished or failed. A message delivered in the middle of another reply,
 * cancelled or stopped by you doesn't notify (the end of the reply in progress does).
 */
function chatReplyNotice(providerId, result) {
  if (!result || result.injected || result.cancelled || result.stopped || result.discarded) return null;
  const name = label(providerId);
  const last = result.followUps?.length ? result.followUps.at(-1).text : "";
  return result.ok
    ? { title: t("notices.replied", { name }), body: short(last || result.output) || t("session.done") }
    : { title: t("notices.failed", { name }), body: short(result.error) || t("session.runFailed") };
}

/** Terminal mode: the CLI finished the reply or stopped waiting for you (an approval, for example). */
function terminalTurnNotice(providerId, lastReply) {
  return {
    title: t("notices.yourTurn", { name: label(providerId) }),
    body: short(lastReply) || t("notices.yourTurnBody"),
  };
}

module.exports = { chatReplyNotice, terminalTurnNotice, PROVIDER_LABELS };
