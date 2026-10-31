// Coordinate session mutations with turn completion. Deletion wins over late replies.
function createSessionService({ store, runner }) {
  const writes = new Map(),
    turns = new Map(),
    removing = new Map(),
    generations = new Map(),
    stopping = new Map();
  const cancelled = () => ({
    ok: false,
    cancelled: true,
    error: "Conversa removida.",
  });
  function write(id, operation) {
    if (removing.has(id))
      return Promise.reject(new Error("Conversa sendo removida."));
    const pending = (writes.get(id) || Promise.resolve())
      .catch(() => {})
      .then(operation);
    writes.set(id, pending);
    pending
      .finally(() => {
        if (writes.get(id) === pending) writes.delete(id);
      })
      .catch(() => {});
    return pending;
  }
  async function stoppedResult(payload, result = {}, started = false) {
    const id = payload.sessionId;
    if (removing.has(id)) return cancelled();
    const text =
      (started
        ? "Execução interrompida pelo usuário."
        : "Envio cancelado antes da execução.") +
      (result.output ? "\n\nSaída parcial:\n" + result.output : "");
    if (
      payload.responseMessageId &&
      (await store.sessionExists(id)) &&
      !removing.has(id)
    ) {
      await write(id, () =>
        store.saveChatMessage({
          id: payload.responseMessageId,
          sessionId: id,
          provider: payload.providerId,
          sender: payload.providerId,
          senderName:
            {
              claude: "Claude Code",
              codex: "Codex CLI",
              antigravity: "Antigravity",
            }[payload.providerId] || payload.providerId,
          text,
          modelBadge: payload.model,
          reasoningBadge: payload.effort,
          timestamp: new Date().toISOString(),
        }),
      );
    }
    return {
      ok: false,
      cancelled: true,
      stopped: true,
      output: text,
      nativeSessionId: result.nativeSessionId,
    };
  }
  function interrupt(id) {
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,200}$/.test(id)
    )
      return Promise.reject(new Error("Conversa inválida."));
    if (stopping.has(id)) return stopping.get(id);
    generations.set(id, (generations.get(id) || 0) + 1);
    const tail = turns.get(id);
    runner.kill(id);
    const pending = (async () => {
      await tail?.catch(() => {});
      await writes.get(id)?.catch(() => {});
      return { ok: true, stopped: true };
    })();
    stopping.set(id, pending);
    pending
      .finally(() => {
        if (stopping.get(id) === pending) stopping.delete(id);
      })
      .catch(() => {});
    return pending;
  }
  function execute(payload) {
    const id = payload?.sessionId;
    if (removing.has(id)) return Promise.resolve(cancelled());
    const previous = turns.get(id);
    const generation = generations.get(id) || 0,
      barrier = stopping.get(id);
    const wasStopped = () =>
      payload.cancelled === true || (generations.get(id) || 0) !== generation;
    const pending = (async () => {
      await barrier?.catch(() => {});
      await previous?.catch(() => {});
      await writes.get(id)?.catch(() => {});
      if (removing.has(id) || !(await store.sessionExists(id)))
        return cancelled();
      if (removing.has(id)) return cancelled();
      if (wasStopped()) return stoppedResult(payload);
      const result = await runner.execute(payload);
      if (removing.has(id)) return cancelled();
      if (wasStopped() || result.cancelled)
        return stoppedResult(payload, result, true);
      if (payload.responseMessageId) {
        try {
          await write(id, () =>
            store.saveChatMessage({
              id: payload.responseMessageId,
              sessionId: id,
              provider: payload.providerId,
              sender: payload.providerId,
              senderName:
                {
                  claude: "Claude Code",
                  codex: "Codex CLI",
                  antigravity: "Antigravity",
                }[payload.providerId] || payload.providerId,
              text: result.ok
                ? result.output || "Execução concluída."
                : `Erro: ${result.error || "Falha na execução."}${result.output ? "\n\n" + result.output : ""}`,
              modelBadge: payload.model,
              reasoningBadge: payload.effort,
              timestamp: new Date().toISOString(),
            }),
          );
        } catch (error) {
          if (removing.has(id)) return cancelled();
          return {
            ...result,
            ok: false,
            error: `A execução terminou, mas a resposta não pôde ser salva: ${error.message}`,
          };
        }
      }
      return removing.has(id) ? cancelled() : result;
    })();
    turns.set(id, pending);
    pending
      .finally(() => {
        if (turns.get(id) === pending) turns.delete(id);
      })
      .catch(() => {});
    return pending;
  }
  function remove(id) {
    if (removing.has(id)) return removing.get(id);
    // Publish the deletion marker before resolving/cancelling the in-flight turn.
    let finish;
    const pending = new Promise((resolve, reject) => {
      finish = { resolve, reject };
    });
    removing.set(id, pending);
    (async () => {
      runner.kill(id);
      await turns.get(id)?.catch(() => {});
      await writes.get(id)?.catch(() => {});
      return store.deleteSessionFromDb(id);
    })()
      .then(finish.resolve, finish.reject)
      .finally(() => removing.delete(id));
    return pending;
  }
  return {
    execute,
    interrupt,
    isBusy: () => turns.size > 0,
    remove,
    saveSession: (session) =>
      write(session.id, () => store.saveSession(session)),
    saveChatMessage: (message) =>
      write(message.sessionId, () => store.saveChatMessage(message)),
    replaceChatMessages: (id, messages) => {
      if (turns.has(id))
        return Promise.reject(
          new Error("Aguarde a execução antes de importar o histórico."),
        );
      return write(id, () => store.replaceChatMessages(id, messages));
    },
  };
}
module.exports = { createSessionService };
