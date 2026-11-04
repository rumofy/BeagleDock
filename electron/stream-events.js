// Linha do tempo de eventos de uma resposta (raciocínio, comandos, ferramentas, MCP, arquivos,
// plano, agentes, compactação…), no mesmo formato para Claude Code, Codex e AGY.
//
// Agentes lançados em segundo plano continuam trabalhando depois que o turno termina (e até depois
// de outro turno começar). Os eventos deles pertencem à resposta que os lançou: o rastreador os
// mantém "soltos" nessa resposta e avisa `onLate` (com atraso) para a tela e o histórico se atualizarem.
const { redact } = require("./redact");

const MAX_EVENTS = 300;
const MAX_TEXT = 4000;
const TEXT_THROTTLE_MS = 120;
const LATE_DEBOUNCE_MS = 400;

// Agentes e comandos lançados em segundo plano seguem rodando depois que o turno termina.
const isBackgroundAgent = (event) =>
  (event.kind === "agent" || event.kind === "command") &&
  event.meta?.background === true;

function createEventTracker({
  emit = () => {},
  sessionId,
  pid = () => undefined,
  now = Date.now,
  // Atualizações fora do turno ativo: ({ sessionId, responseMessageId, events }).
  onLate = () => {},
  setTimer = (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimer = clearTimeout,
}) {
  // Um grupo de eventos por resposta: o atual e os "soltos" (agentes em segundo plano).
  const groups = new Map();
  let currentId;
  let active = false;
  // Respostas anteriores do turno em andamento: uma mensagem entregue no meio do turno abre uma
  // resposta nova (ver `rotate`), e o que já estava rodando continua na resposta de antes.
  const turnIds = new Set();
  const lastPublished = new Map();
  const lateTimers = new Map();
  // Texto bruto do raciocínio: mascarar só a cópia publicada, senão um segredo cortado entre dois
  // trechos escaparia (o primeiro vira ***, o resto da chave chega depois).
  const raw = new Map();

  const group = (responseId) => {
    if (!groups.has(responseId)) groups.set(responseId, new Map());
    return groups.get(responseId);
  };
  // Em que resposta está um evento: a atual, uma solta que já o tem, ou a do pai (filho tardio).
  function locate(id, parentId) {
    if (group(currentId).has(id)) return currentId;
    for (const [responseId, events] of groups)
      if (responseId !== currentId && events.has(id)) return responseId;
    if (parentId) {
      for (const [responseId, events] of groups)
        if (responseId !== currentId && events.has(parentId)) return responseId;
    }
    return currentId;
  }
  const isLate = (responseId) =>
    !active || (responseId !== currentId && !turnIds.has(responseId));

  function scheduleLate(responseId) {
    if (lateTimers.has(responseId)) return;
    lateTimers.set(
      responseId,
      setTimer(() => flushLateFor(responseId), LATE_DEBOUNCE_MS),
    );
  }
  function flushLateFor(responseId) {
    const timer = lateTimers.get(responseId);
    if (timer === undefined) return;
    clearTimer(timer);
    lateTimers.delete(responseId);
    const events = groups.get(responseId);
    if (events)
      onLate({
        sessionId,
        responseMessageId: responseId,
        events: [...events.values()],
      });
    // Resposta solta sem nada em andamento: pode ser esquecida.
    if (
      events &&
      responseId !== currentId &&
      ![...events.values()].some((e) => e.status === "running")
    )
      groups.delete(responseId);
  }

  const publish = (event, responseId) => {
    lastPublished.set(event.id, now());
    emit("cli-activity-event", {
      sessionId,
      responseMessageId: responseId,
      event: { ...event },
      pid: pid(),
    });
  };

  function upsert(id, patch = {}, { quiet = false } = {}) {
    if (!id) return null;
    const responseId = locate(id, patch.parentId);
    const events = group(responseId);
    let event = events.get(id);
    if (!event) {
      if (events.size >= MAX_EVENTS) return null;
      event = {
        id,
        kind: "status",
        title: "",
        status: "running",
        startedAt: now(),
      };
    }
    const next = { ...event, ...patch };
    if (patch.meta) next.meta = { ...event.meta, ...patch.meta };
    // Nada sensível sai daqui: o mesmo evento é exibido ao vivo e gravado no histórico.
    for (const key of ["title", "detail", "text"])
      if (typeof next[key] === "string") next[key] = redact(next[key]);
    if (typeof next.text === "string" && next.text.length > MAX_TEXT)
      next.text = "…" + next.text.slice(-MAX_TEXT + 1);
    events.set(id, next);
    if (!quiet) publish(next, responseId);
    if (isLate(responseId)) scheduleLate(responseId);
    return next;
  }

  function finishGroup(responseId, status, all) {
    const events = groups.get(responseId);
    if (!events) return;
    const background = new Set(
      all ? [] : [...events.values()].filter(isBackgroundAgent).map((e) => e.id),
    );
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of events.values())
        if (
          e.parentId &&
          background.has(e.parentId) &&
          !background.has(e.id)
        ) {
          background.add(e.id);
          grew = true;
        }
    }
    for (const event of [...events.values()])
      if (event.status === "running" && !background.has(event.id))
        api.finish(event.id, status);
  }

  const api = {
    // Começa a resposta `id`. Agentes em segundo plano ainda rodando (e o que é deles) ficam soltos
    // na resposta de origem, em vez de sumir.
    start(id) {
      for (const previous of [...turnIds, currentId]) {
        if (previous === undefined) continue;
        const events = groups.get(previous);
        if (events) {
          const keep = new Set(
            [...events.values()]
              .filter((e) => isBackgroundAgent(e) && e.status === "running")
              .map((e) => e.id),
          );
          let grew = true;
          while (grew) {
            grew = false;
            for (const e of events.values())
              if (e.parentId && keep.has(e.parentId) && !keep.has(e.id)) {
                keep.add(e.id);
                grew = true;
              }
          }
          if (keep.size) {
            for (const eventId of [...events.keys()])
              if (!keep.has(eventId)) events.delete(eventId);
          } else groups.delete(previous);
        }
      }
      turnIds.clear();
      currentId = id;
      groups.set(id, new Map());
      active = true;
      lastPublished.clear();
      // O texto bruto de eventos soltos é mantido; o resto é descartado.
      for (const key of [...raw.keys()]) if (!api.get(key)) raw.delete(key);
    },
    // Mensagem entregue no meio do turno: as etapas novas vão para a resposta `id`; as que já
    // existiam (um comando ainda rodando, por exemplo) continuam e terminam na resposta de antes.
    rotate(id) {
      if (!id || id === currentId) return;
      if (currentId !== undefined) turnIds.add(currentId);
      currentId = id;
      groups.set(id, new Map());
    },
    // O turno terminou; o que ainda mudar a partir daqui é atualização tardia.
    endTurn() {
      active = false;
    },
    upsert,
    appendText(id, delta, patch = {}) {
      if (!delta) return;
      const current = api.get(id);
      const text = (raw.get(id) || "") + delta;
      raw.set(
        id,
        text.length > MAX_TEXT * 2 ? text.slice(-MAX_TEXT * 2) : text,
      );
      const next = upsert(id, { ...patch, text: raw.get(id) }, { quiet: true });
      // O primeiro trecho sai na hora; os seguintes, no máximo a cada 120 ms.
      if (
        next &&
        (!current?.text ||
          now() - (lastPublished.get(id) || 0) >= TEXT_THROTTLE_MS)
      )
        publish(next, locate(id, patch.parentId));
    },
    // Substitui o texto inteiro (ex.: raciocínio montado a partir de partes), com a mesma regra.
    setText(id, text, patch = {}) {
      const current = api.get(id);
      raw.set(id, String(text ?? ""));
      const next = upsert(id, { ...patch, text }, { quiet: true });
      if (
        next &&
        (!current?.text ||
          now() - (lastPublished.get(id) || 0) >= TEXT_THROTTLE_MS)
      )
        publish(next, locate(id, patch.parentId));
    },
    finish(id, status = "done", patch = {}) {
      const current = api.get(id);
      if (!current || current.status !== "running") return;
      const endedAt = now();
      upsert(id, {
        ...patch,
        status,
        endedAt,
        durationMs: patch.durationMs ?? endedAt - current.startedAt,
      });
    },
    // Encerra o que ainda roda no turno, MENOS agentes em segundo plano (e as etapas deles): esses
    // seguem trabalhando e terminam sozinhos, pelo evento final da própria CLI.
    // Com `all`, encerra também os em segundo plano (a CLI acabou: nada mais vai avisar o fim deles).
    finishRunning(status = "done", { all = false } = {}) {
      for (const responseId of [...turnIds, currentId]) finishGroup(responseId, status, all);
    },
    // A CLI encerrou: nada mais vai avisar o fim do que ainda constava como rodando.
    finishAll(status = "error", note = "a CLI encerrou antes de avisar o fim") {
      for (const events of [...groups.values()])
        for (const event of [...events.values()])
          if (event.status === "running")
            api.finish(event.id, status, {
              meta: { note: event.meta?.note ? `${event.meta.note} · ${note}` : note },
            });
    },
    get(id) {
      for (const events of groups.values())
        if (events.has(id)) return events.get(id);
      return undefined;
    },
    // Eventos da resposta atual (o que o turno devolve ao terminar).
    snapshot: () => [...group(currentId).values()],
    // Eventos de uma resposta do turno (a original ou a de uma mensagem entregue no meio).
    snapshotFor: (id) => [...(groups.get(id)?.values() || [])],
    // Procura em todas as respostas (uma mensagem entregue no meio do turno abre outra resposta).
    find(predicate) {
      for (const events of groups.values())
        for (const event of events.values()) if (predicate(event)) return event;
      return undefined;
    },
    filter(predicate) {
      const found = [];
      for (const events of groups.values())
        for (const event of events.values()) if (predicate(event)) found.push(event);
      return found;
    },
    // Entrega já as atualizações tardias pendentes (encerramento do app, testes).
    flushLate() {
      for (const responseId of [...lateTimers.keys()]) flushLateFor(responseId);
    },
  };
  return api;
}

module.exports = { createEventTracker, MAX_EVENTS, MAX_TEXT };
