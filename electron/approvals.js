const { randomUUID } = require("crypto");
function createApprovalBroker({ emit = () => {}, timeout = 120000 } = {}) {
  const requests = new Map();
  const list = () => [...requests.values()].map((r) => r.public);
  const publish = () => emit("cli-approvals", list());
  function ask(request) {
    return new Promise((resolve) => {
      const id = randomUUID(),
        timer = setTimeout(() => finish(id, false), timeout);
      timer.unref?.();
      requests.set(id, {
        public: {
          id,
          sessionId: request.sessionId,
          providerId: request.providerId,
          tool: String(request.tool || "Ferramenta").slice(0, 200),
          input: JSON.stringify(request.input || {}, null, 2).slice(0, 16000),
        },
        resolve,
        timer,
      });
      publish();
    });
  }
  function finish(id, allow) {
    const entry = requests.get(id);
    if (!entry) return false;
    requests.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(allow);
    publish();
    return true;
  }
  return {
    ask,
    list,
    resolve(id, decision) {
      if (typeof id !== "string" || !["allow", "deny"].includes(decision))
        throw new Error("Resposta de permissão inválida.");
      return { ok: finish(id, decision === "allow") };
    },
    cancelSession(id) {
      for (const [key, r] of requests)
        if (r.public.sessionId === id) finish(key, false);
    },
    shutdown() {
      for (const id of requests.keys()) finish(id, false);
    },
  };
}
module.exports = { createApprovalBroker };
