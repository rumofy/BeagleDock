// Coordinate session mutations with turn completion. Deletion wins over late replies.
// Momento no formato do banco (UTC, com milissegundos): ordena entre os de segundo inteiro.
const dbTime = (ms) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");
const PROVIDER_NAMES = {
  claude: "Claude Code",
  codex: "Codex CLI",
  antigravity: "Antigravity",
};

function createSessionService({ store, runner }) {
  const writes = new Map(),
    turns = new Map(),
    removing = new Map(),
    generations = new Map(),
    stopping = new Map(),
    // Quantas execuções (rodando + na fila) cada conversa tem; a mensagem só entra no turno atual
    // quando ele é o único à frente dela.
    pendingCount = new Map(),
    // Respostas enfileiradas que a pessoa tirou da fila e as que a CLI já começou a processar.
    discarded = new Set(),
    started = new Set(),
    // Respostas esperando na fila de cada conversa (em ordem), as que estão decidindo entre injetar
    // e enfileirar, a cadeia dessas decisões e as mensagens do usuário já removidas da fila.
    queuedOrder = new Map(),
    reserved = new Set(),
    decisions = new Map(),
    droppedUsers = new Set();
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
  // Respostas às mensagens entregues no meio do turno: cada uma é gravada logo antes da mensagem
  // seguinte (a última, no fim), para o histórico reaberto manter a ordem vista na tela.
  async function saveFollowUps(payload, result, tail = "") {
    const id = payload.sessionId;
    const list = result.followUps || [];
    const out = [];
    for (let index = 0; index < list.length; index++) {
      const item = list[index];
      const last = index === list.length - 1;
      const text = item.text || (last ? tail : "");
      out.push({ responseMessageId: item.responseMessageId, text });
      if (!text || removing.has(id)) continue;
      const next = list[index + 1];
      await write(id, () =>
        store.saveChatMessage({
          id: item.responseMessageId,
          sessionId: id,
          provider: payload.providerId,
          sender: payload.providerId,
          senderName: PROVIDER_NAMES[payload.providerId] || payload.providerId,
          text,
          modelBadge: payload.model,
          reasoningBadge: payload.effort,
          timestamp: new Date().toISOString(),
          // A última termina agora; sem milissegundos ela empataria com a mensagem entregue e perderia.
          createdAt: dbTime(next ? next.at - 1 : Date.now()),
        }),
      ).catch(() => {});
    }
    return out;
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
          events: result.events,
          modelBadge: payload.model,
          reasoningBadge: payload.effort,
          timestamp: new Date().toISOString(),
          ...(result.followUps?.length
            ? { createdAt: dbTime(result.followUps[0].at - 1) }
            : {}),
        }),
      );
    }
    const followUps = await saveFollowUps(payload, result);
    return {
      ok: false,
      cancelled: true,
      stopped: true,
      output: text,
      ...(followUps.length ? { followUps } : {}),
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
  const validIds = (request) =>
    request &&
    [request.sessionId, request.responseMessageId, request.userMessageId].every(
      (v) => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,200}$/.test(v),
    );
  const waiting = (id) => {
    if (!queuedOrder.has(id)) queuedOrder.set(id, []);
    return queuedOrder.get(id);
  };
  // A mensagem deixou a espera: foi entregue, descartada ou terminou.
  function leave(id, responseId) {
    const list = queuedOrder.get(id);
    if (list) {
      const at = list.indexOf(responseId);
      if (at >= 0) list.splice(at, 1);
      if (!list.length) queuedOrder.delete(id);
    }
    reserved.delete(responseId);
  }
  // Só pode ser removida/forçada uma mensagem que ainda está esperando na fila desta conversa e que
  // a CLI não recebeu nem está em vias de receber.
  const isWaiting = (request) =>
    waiting(request.sessionId).includes(request.responseMessageId) &&
    !reserved.has(request.responseMessageId) &&
    !started.has(request.responseMessageId);
  // Tira da fila uma mensagem ainda não entregue à CLI e apaga o que foi salvo dela.
  async function cancelQueued(request) {
    if (!validIds(request)) return { ok: false, error: "Mensagem inválida." };
    const { sessionId, responseMessageId, userMessageId } = request;
    if (!isWaiting(request))
      return { ok: false, error: "A mensagem não está mais esperando na fila." };
    discarded.add(responseMessageId);
    leave(sessionId, responseMessageId);
    // Um salvamento da mensagem ainda a caminho não pode recriá-la depois.
    droppedUsers.add(userMessageId);
    if (droppedUsers.size > 500) droppedUsers.delete(droppedUsers.values().next().value);
    try {
      await write(sessionId, async () => {
        await store.deleteChatMessage?.(sessionId, userMessageId);
        await store.deleteChatMessage?.(sessionId, responseMessageId);
      });
    } catch {}
    return { ok: true };
  }
  // "Enviar agora": derruba a execução em andamento; a próxima da fila é esta, por isso só a primeira
  // mensagem esperando pode ser forçada (as demais manteriam a ordem e interromperiam o que não deve).
  async function forceQueued(request) {
    if (!validIds(request)) return { ok: false, error: "Mensagem inválida." };
    if (!isWaiting(request) || waiting(request.sessionId)[0] !== request.responseMessageId)
      return { ok: false, error: "Só a próxima mensagem da fila pode ser enviada agora." };
    runner.kill(request.sessionId);
    return { ok: true };
  }
  async function execute(payload) {
    const id = payload?.sessionId;
    if (removing.has(id)) return cancelled();
    const responseId = payload?.responseMessageId;
    // O Parar vale para o que já foi enviado: a geração e a barreira são lidas já na entrada.
    const stopState = {
      generation: generations.get(id) || 0,
      barrier: stopping.get(id),
    };
    payload = { ...payload, __stop: stopState };
    pendingCount.set(id, (pendingCount.get(id) || 0) + 1);
    if (responseId) {
      waiting(id).push(responseId);
      // Enquanto a decisão (injetar ou enfileirar) não sai, a mensagem não pode ser removida.
      reserved.add(responseId);
    }
    // As decisões de uma conversa saem em ordem: uma injeção lenta não deixa a seguinte furar a fila.
    const decision = (decisions.get(id) || Promise.resolve()).then(() => decide(payload));
    decisions.set(id, decision.catch(() => {}));
    const outcome = await decision;
    return outcome.result ?? outcome.pending;
  }
  async function decide(payload) {
    const id = payload.sessionId;
    const responseId = payload.responseMessageId;
    const drop = (result) => {
      leave(id, responseId);
      const left = (pendingCount.get(id) || 1) - 1;
      if (left > 0) pendingCount.set(id, left);
      else pendingCount.delete(id);
      return { result };
    };
    if (removing.has(id)) return drop(cancelled());
    // A CLI recebe a mensagem no meio da execução, como na CLI original (Claude Code: na próxima
    // etapa; Codex: turn/steer). Só entra se não houver outra mensagem esperando na frente.
    if (
      turns.has(id) &&
      (pendingCount.get(id) || 0) === 2 &&
      !stopping.has(id) &&
      payload.cancelled !== true &&
      !discarded.has(responseId) &&
      typeof runner.inject === "function"
    ) {
      const delivered = await runner.inject(payload);
      if (delivered) {
        // A mensagem passa a ficar entre a resposta que estava sendo escrita e a próxima: a ordem
        // do histórico segue o momento da entrega (ver `replyTimes`).
        const at = typeof delivered === "object" ? delivered.at : undefined;
        if (at && payload.userMessageId && typeof store.setMessageTime === "function")
          await write(id, () =>
            store.setMessageTime(id, payload.userMessageId, dbTime(at)),
          ).catch(() => {});
        return drop({
          ok: true,
          injected: true,
          ...(typeof delivered === "object" && delivered.from
            ? { rotatedFrom: delivered.from }
            : {}),
          output: "",
        });
      }
    }
    if (removing.has(id)) return drop(cancelled());
    reserved.delete(responseId);
    const { __stop: stop, ...clean } = payload;
    return { pending: enqueue(clean, stop) };
  }
  function enqueue(payload, stop) {
    const id = payload?.sessionId;
    const previous = turns.get(id);
    const generation = stop.generation,
      barrier = stop.barrier;
    const wasStopped = () =>
      payload.cancelled === true || (generations.get(id) || 0) !== generation;
    const pending = (async () => {
      await barrier?.catch(() => {});
      await previous?.catch(() => {});
      await writes.get(id)?.catch(() => {});
      if (removing.has(id) || !(await store.sessionExists(id)))
        return cancelled();
      if (removing.has(id)) return cancelled();
      if (discarded.has(payload.responseMessageId))
        return { ok: false, cancelled: true, discarded: true };
      if (wasStopped()) return stoppedResult(payload);
      started.add(payload.responseMessageId);
      leave(id, payload.responseMessageId);
      const result = await runner.execute(payload);
      if (removing.has(id)) return cancelled();
      if (wasStopped() || result.cancelled)
        return stoppedResult(payload, result, true);
      if (result.context && typeof store.setSessionContext === "function")
        await write(id, () => store.setSessionContext(id, result.context)).catch(() => {});
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
              // Com mensagens entregues no meio do turno, o erro vai na última resposta.
              text: result.followUps?.length
                ? result.output || ""
                : result.ok
                  ? result.output || "Execução concluída."
                  : `Erro: ${result.error || "Falha na execução."}${result.output ? "\n\n" + result.output : ""}`,
              events: result.events,
              modelBadge: payload.model,
              reasoningBadge: payload.effort,
              timestamp: new Date().toISOString(),
              ...(result.followUps?.length
                ? { createdAt: dbTime(result.followUps[0].at - 1) }
                : {}),
            }),
          );
          if (result.followUps?.length) {
            const followUps = await saveFollowUps(
              payload,
              result,
              result.ok ? "" : `Erro: ${result.error || "Falha na execução."}`,
            );
            return removing.has(id) ? cancelled() : { ...result, followUps };
          }
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
        const left = (pendingCount.get(id) || 1) - 1;
        if (left > 0) pendingCount.set(id, left);
        else pendingCount.delete(id);
        started.delete(payload.responseMessageId);
        discarded.delete(payload.responseMessageId);
        leave(id, payload.responseMessageId);
        if (decisions.get(id) && !turns.has(id) && !(pendingCount.get(id) || 0))
          decisions.delete(id);
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
    cancelQueued,
    forceQueued,
    isBusy: () => turns.size > 0,
    // Sessões com turno rodando ou na fila (a fila aguarda dentro de `turns`).
    activeCount: () => turns.size,
    activeIds: () => [...turns.keys()],
    remove,
    // Turno que a CLI começou sozinha (agente principal respondendo depois de um agente em segundo
    // plano): grava como uma resposta nova da conversa.
    saveAutoTurn: async (p) => {
      if (!p || p.discard || !p.responseMessageId) return;
      try {
        if (!(await store.sessionExists(p.sessionId))) return;
        const names = { claude: "Claude Code", codex: "Codex CLI", antigravity: "Antigravity" };
        await write(p.sessionId, async () => {
          await store.saveChatMessage({
            id: p.responseMessageId,
            sessionId: p.sessionId,
            provider: p.providerId,
            sender: p.providerId,
            senderName: names[p.providerId] || p.providerId,
            text: p.ok
              ? p.text || "Execução concluída."
              : `Erro: ${p.error || "Falha na execução."}${p.text ? "\n\n" + p.text : ""}`,
            events: p.events,
            modelBadge: p.model,
            timestamp: new Date().toISOString(),
          });
          if (p.context && typeof store.setSessionContext === "function")
            await store.setSessionContext(p.sessionId, p.context);
        });
      } catch {}
    },
    saveLateEvents: ({ sessionId, responseMessageId, events }) =>
      typeof store.mergeMessageEvents === "function"
        ? write(sessionId, () =>
            store.mergeMessageEvents(sessionId, responseMessageId, events),
          ).catch(() => {})
        : Promise.resolve(),
    setSessionContext: (id, context) =>
      write(id, () => store.setSessionContext(id, context)),
    setSessionArchived: (id, archived) =>
      write(id, () => store.setSessionArchived(id, archived)),
    saveSession: (session) =>
      write(session.id, () => store.saveSession(session)),
    saveChatMessage: (message) =>
      droppedUsers.has(message.id)
        ? Promise.resolve({ success: true })
        : write(message.sessionId, () => store.saveChatMessage(message)),
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
