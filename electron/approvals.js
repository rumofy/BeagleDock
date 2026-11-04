const { randomUUID } = require("crypto");
const { ALLOW_ONCE, DENY } = require("./approval-options");
const { t } = require("./i18n");
const { userQuestions, validateAnswers } = require("./user-questions");

// timeout 0 = the approval waits for the person's decision (as in the terminal); only cancelling the session denies it.
function createApprovalBroker({ emit = () => {}, timeout = 0 } = {}) {
  const requests = new Map();
  const list = () => [...requests.values()].map((r) => r.public);
  const publish = () => emit("cli-approvals", list());

  // `request.options` are the CLI's native options (public); `request.native` keeps, by id,
  // what to return to the CLI and never goes to the interface.
  function askDetailed(request) {
    return new Promise((resolve) => {
      const id = randomUUID(),
        timer = timeout > 0 ? setTimeout(() => finish(id, { optionId: "deny", allow: false }), timeout) : undefined;
      timer?.unref?.();
      const questions = request.kind === "question" ? userQuestions(request.input) : [];
      const options =
        Array.isArray(request.options) && request.options.length ? request.options : [ALLOW_ONCE, DENY];
      requests.set(id, {
        public: {
          id,
          sessionId: request.sessionId,
          providerId: request.providerId,
          ...(request.kind === "plan" || request.kind === "question" ? { kind: request.kind } : {}),
          ...(questions.length ? { questions } : {}),
          tool: String(request.tool || "Ferramenta").slice(0, 200),
          input: (typeof request.input === "string"
            ? request.input
            : JSON.stringify(request.input || {}, null, 2)
          ).slice(0, 16000),
          options: options.map(({ id: optionId, label, kind, description, persistent, danger, allowsMessage }) => ({
            id: optionId,
            label: String(label).slice(0, 300),
            kind,
            ...(description ? { description: String(description).slice(0, 300) } : {}),
            ...(persistent ? { persistent: true } : {}),
            ...(danger ? { danger: true } : {}),
            ...(allowsMessage ? { allowsMessage: true } : {}),
          })),
        },
        options,
        native: request.native || {},
        resolve,
        timer,
      });
      publish();
    });
  }
  function finish(id, result) {
    const entry = requests.get(id);
    if (!entry) return false;
    requests.delete(id);
    clearTimeout(entry.timer);
    const option = entry.options.find((o) => o.id === result.optionId);
    entry.resolve({
      ...result,
      option,
      native: entry.native[result.optionId],
    });
    publish();
    return true;
  }
  return {
    // Compatible: callers that only need yes/no keep getting a boolean.
    ask: (request) => askDetailed(request).then((r) => r.allow),
    askDetailed,
    list,
    // `decision`: "allow" | "deny" (first option of that type) or the id of an offered option.
    resolve(id, decision, { message, answers } = {}) {
      if (typeof id !== "string" || typeof decision !== "string")
        throw new Error(t("errors.invalidApprovalAnswer"));
      const entry = requests.get(id);
      if (!entry) return { ok: false };
      if (entry.public.kind === "question" && decision !== "deny") {
        const validated = decision === "answer" && validateAnswers(entry.public.questions || [], answers);
        if (!validated) throw new Error(t("errors.invalidApprovalAnswer"));
        return { ok: finish(id, { optionId: "answer", allow: true, answers: validated }) };
      }
      const option =
        entry.options.find((o) => o.id === decision) ||
        (decision === "allow" || decision === "deny"
          ? entry.options.find((o) => o.kind === decision)
          : undefined);
      if (!option) throw new Error(t("errors.invalidApprovalOption"));
      return {
        ok: finish(id, {
          optionId: option.id,
          allow: option.kind === "allow",
          ...(option.kind === "deny" && typeof message === "string" && message.trim()
            ? { message: message.trim().slice(0, 1000) }
            : {}),
        }),
      };
    },
    // The conversation switched to "Full access": what was waiting is allowed once, as if the
    // person clicked allow (never an option that saves a permanent rule).
    // Plans and questions are not permissions: full access never approves a plan or answers for you.
    approveSession(id) {
      let count = 0;
      for (const [key, r] of requests) {
        if (r.public.sessionId !== id || r.public.kind) continue;
        const option =
          r.options.find((o) => o.kind === "allow" && !o.persistent && o.id === ALLOW_ONCE.id) ||
          r.options.find((o) => o.kind === "allow" && !o.persistent);
        if (option && finish(key, { optionId: option.id, allow: true })) count++;
      }
      return count;
    },
    cancelSession(id) {
      for (const [key, r] of requests)
        if (r.public.sessionId === id) finish(key, { optionId: "deny", allow: false, cancelled: true });
    },
    shutdown() {
      for (const id of requests.keys()) finish(id, { optionId: "deny", allow: false, cancelled: true });
    },
  };
}
module.exports = { createApprovalBroker };
