const { randomUUID } = require("crypto");
const { ALLOW_ONCE, DENY } = require("./approval-options");

// timeout 0 = a aprovação espera a decisão da pessoa (como no terminal); só cancelar a sessão a nega.
function createApprovalBroker({ emit = () => {}, timeout = 0 } = {}) {
  const requests = new Map();
  const list = () => [...requests.values()].map((r) => r.public);
  const publish = () => emit("cli-approvals", list());

  // `request.options` são as opções nativas da CLI (públicas); `request.native` guarda, por id,
  // o que devolver à CLI e nunca vai para a interface.
  function askDetailed(request) {
    return new Promise((resolve) => {
      const id = randomUUID(),
        timer = timeout > 0 ? setTimeout(() => finish(id, { optionId: "deny", allow: false }), timeout) : undefined;
      timer?.unref?.();
      const options =
        Array.isArray(request.options) && request.options.length ? request.options : [ALLOW_ONCE, DENY];
      requests.set(id, {
        public: {
          id,
          sessionId: request.sessionId,
          providerId: request.providerId,
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
    // Compatível: quem só precisa de sim/não continua recebendo um booleano.
    ask: (request) => askDetailed(request).then((r) => r.allow),
    askDetailed,
    list,
    // `decision`: "allow" | "deny" (primeira opção desse tipo) ou o id de uma opção oferecida.
    resolve(id, decision, { message } = {}) {
      if (typeof id !== "string" || typeof decision !== "string")
        throw new Error("Resposta de permissão inválida.");
      const entry = requests.get(id);
      if (!entry) return { ok: false };
      const option =
        entry.options.find((o) => o.id === decision) ||
        (decision === "allow" || decision === "deny"
          ? entry.options.find((o) => o.kind === decision)
          : undefined);
      if (!option) throw new Error("Opção de permissão inválida.");
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
    // A conversa passou para "Acesso total": o que estava esperando é autorizado uma vez, como se a
    // pessoa clicasse em permitir (nunca uma opção que grava regra permanente).
    approveSession(id) {
      let count = 0;
      for (const [key, r] of requests) {
        if (r.public.sessionId !== id) continue;
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
