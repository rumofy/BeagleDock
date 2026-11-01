const { StringDecoder } = require("string_decoder");
const { randomUUID } = require("crypto");
const { terminateCli } = require("./platform");
const { createStderrFilter } = require("./codex-mcp-auth");
const { codexItemActivity, reasoningTail } = require("./activity-labels");
const { LIVE_OUTPUT_GUIDANCE } = require("./guidance");
const { createEventTracker } = require("./stream-events");
const { codexContext, createContextTracker } = require("./context-usage");
const { askApproval, codexApprovalOptions } = require("./approval-options");

const textOf = (value) =>
  (Array.isArray(value) ? value : value == null ? [] : [value])
    .map((part) => (typeof part === "string" ? part : part?.text || ""))
    .filter(Boolean)
    .join("\n\n");
const planText = (plan, explanation) =>
  [
    explanation,
    ...(Array.isArray(plan) ? plan : []).map(
      (step) =>
        `${step?.status === "completed" ? "[x]" : step?.status === "inProgress" ? "[~]" : "[ ]"} ${step?.step || ""}`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
function createCodexStream({
  spawn,
  store,
  emit = () => {},
  turnTimeout = 0, // 0 = sem limite de tempo por turno
  approvals,
  onMcpAuthError = () => {},
  onLateEvents = () => {},
  onAutoTurn = () => {},
}) {
  const entries = new Map();
  let sequence = 0;
  function close(id) {
    approvals?.cancelSession(id);
    const e = entries.get(id);
    if (!e) return;
    entries.delete(id);
    e.finish?.({
      ok: false,
      cancelled: true,
      output: e.text,
      error: "Execução interrompida.",
    });
    for (const p of e.requests.values()) p.reject(new Error("CLI encerrada."));
    e.requests.clear();
    try {
      e.child.stdin.end();
      terminateCli(e.child);
    } catch {}
  }
  async function execute(p) {
    const {
      sessionId,
      bin,
      cwd,
      model,
      effort,
      permission,
      nativeId,
      responseMessageId,
    } = p;
    const key = JSON.stringify([
      bin,
      cwd,
      model,
      effort,
      permission,
      p.fingerprint,
      p.autoCompactTokens || 0,
    ]);
    let e = entries.get(sessionId);
    if (e && (e.key !== key || e.child.killed || e.child.exitCode !== null)) {
      close(sessionId);
      e = null;
    }
    if (!e) {
      const config = [];
      if (permission !== "inherit")
        config.push(
          "-c",
          `sandbox_mode=${JSON.stringify(["plan", "ask"].includes(permission) ? "read-only" : permission === "full" ? "danger-full-access" : "workspace-write")}`,
          "-c",
          `approval_policy="${approvals && permission === "edits" ? "on-request" : "never"}"`,
        );
      if (p.autoCompactTokens > 0)
        config.push("-c", `model_auto_compact_token_limit=${p.autoCompactTokens}`);
      if (model) config.push("-c", `model=${JSON.stringify(model)}`);
      if (effort)
        config.push("-c", `model_reasoning_effort=${JSON.stringify(effort)}`);
      const child = spawn(
        bin,
        ["app-server", "--listen", "stdio://", ...config],
        {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
        },
      );
      e = {
        key,
        cwd,
        selection: JSON.stringify([model, effort, permission]),
        child,
        requests: new Map(),
        nativeId,
        text: "",
        messages: new Map(),
        commands: new Map(),
        stderr: "",
        buffer: "",
        turnId: null,
        model,
      };
      e.events = createEventTracker({
        emit,
        sessionId,
        pid: () => child.pid,
        onLate: onLateEvents,
      });
      e.context = createContextTracker({ emit, sessionId, source: "codex" });
      entries.set(sessionId, e);
      const current = e;
      // `shellId` é o id do evento da linha do tempo do comando que produziu a saída.
      const output = (data, shellId) =>
        emit("pty-data", {
          sessionId,
          data,
          pid: child.pid,
          ...(shellId ? { shellId } : {}),
        });
      const send = (message) =>
        child.stdin.write(JSON.stringify(message) + "\n");
      const request = (method, params) =>
        new Promise((resolve, reject) => {
          const id = `beagledock-${++sequence}`;
          const timer = setTimeout(() => {
            current.requests.delete(id);
            reject(new Error(`Tempo limite no protocolo Codex (${method}).`));
          }, 30000);
          current.requests.set(id, {
            resolve: (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          });
          try {
            send({ id, method, params });
          } catch (error) {
            current.requests.get(id)?.reject(error);
            current.requests.delete(id);
          }
        });
      current.request = request;
      const publish = () => {
        current.text = [...current.messages.values()].join("\n\n");
        emit("cli-stream-chunk", {
          sessionId,
          responseMessageId: current.responseMessageId,
          fullText: current.text,
          pid: child.pid,
        });
      };
      const sendActivity = (activity, detail) =>
        emit("cli-stream-chunk", {
          sessionId,
          responseMessageId: current.responseMessageId,
          activity,
          ...(detail ? { detail } : {}),
          pid: child.pid,
        });
      // Uma compactação manual em andamento bloqueia o envio seguinte até terminar.
      function settleCompaction(entry) {
        const c = entry.compaction;
        if (!c) return;
        clearTimeout(c.timer);
        entry.compaction = null;
        entry.manualCompaction = false;
        entry.context.compacting(false);
        c.resolve();
      }
      function markCompacted(entry) {
        entry.context.compacted({ trigger: entry.manualCompaction ? "manual" : "auto" });
        settleCompaction(entry);
      }
      // Turno que o app-server começou sozinho (ex.: o agente principal recebeu o resultado de um
      // agente e responde): vira uma mensagem nova, em vez de ser descartado.
      function startAutoTurn() {
        const id = `auto-${randomUUID()}`;
        current.messages.clear();
        current.commands.clear();
        current.text = "";
        current.error = null;
        current.reasoningParts = new Map();
        current.responseMessageId = id;
        current.events.start(id);
        let resolveDone;
        current.autoDone = new Promise((r) => (resolveDone = r));
        current.finish = (result) => {
          current.finish = null;
          current.events.finishRunning(result.ok ? "done" : "error");
          const events = current.events.snapshot();
          current.events.endTurn();
          const text = String(result.output || current.text || "");
          const payload = {
            sessionId,
            providerId: "codex",
            responseMessageId: id,
            ok: !!result.ok,
            text,
            error: result.error,
            events,
            model: current.model,
            // Compactação automática, parada ou turno sem texto: nada a mostrar no chat.
            discard: !!result.cancelled || (!text.trim() && !result.error),
            context: current.context.hasData() ? current.context.snapshot() : undefined,
          };
          emit("cli-turn-finished", payload);
          try {
            onAutoTurn(payload);
          } finally {
            current.autoDone = null;
            resolveDone();
          }
        };
        emit("cli-turn-started", {
          sessionId,
          responseMessageId: id,
          providerId: "codex",
          model: current.model,
        });
      }
      const SUB_KINDS = new Set(["command", "mcp", "tool", "file", "web"]);
      function commandOutput(id, delta) {
        current.commands.set(id, (current.commands.get(id) || "") + delta);
        output(delta, id);
      }
      function completeCommand(id, item) {
        const received = current.commands.get(id) || "";
        const full = item.aggregatedOutput || "";
        if (full && full !== received) {
          if (full.startsWith(received)) output(full.slice(received.length), id);
          else if (received && full.endsWith(received))
            output("\r\n[Início da saída]\r\n" + full.slice(0, -received.length), id);
          else if (!received) output(full, id);
        }
        output("\r\n", id);
        current.commands.delete(id);
      }
      function handleSubThreadItem(method, params, parentId) {
        const id = `${params.threadId}:${params.itemId || params.item?.id}`;
        if (method === "item/commandExecution/outputDelta") {
          commandOutput(id, params.delta || "");
          return;
        }
        const item = params.item || {};
        if (!["item/started", "item/completed"].includes(method)) return;
        const label = codexItemActivity(item);
        if (!label || !SUB_KINDS.has(label.kind) || !item.id) return;
        if (!current.events.get(id)) {
          current.events.upsert(id, {
            kind: label.kind,
            title: label.title,
            detail: label.detail,
            parentId,
            ...(label.note ? { meta: { note: label.note } } : {}),
          });
          if (item.type === "commandExecution") output(`$ ${item.command}\r\n`, id);
        }
        if (method === "item/completed") {
          current.events.finish(
            id,
            ["failed", "declined"].includes(item.status) || item.error
              ? "error"
              : "done",
            Number.isFinite(item.durationMs)
              ? { durationMs: item.durationMs }
              : {},
          );
          if (item.type === "commandExecution") completeCommand(id, item);
        }
      }
      // Registra as conversas dos agentes lançados, para rotear as etapas delas.
      function learnSubThreads(item) {
        const ids =
          item.type === "collabAgentToolCall" && ["spawnAgent", "spawn_agent"].includes(item.tool)
            ? Array.isArray(item.receiverThreadIds)
              ? item.receiverThreadIds
              : []
            : item.type === "subAgentActivity" && item.agentThreadId
              ? [item.agentThreadId]
              : [];
        if (!ids.length || !item.id) return;
        current.subThreads ||= new Map();
        for (const threadId of ids)
          if (typeof threadId === "string")
            if (!current.subThreads.has(threadId)) current.subThreads.set(threadId, item.id);
        // Agente do Codex pode seguir trabalhando depois do fim do turno: não é encerrado com ele.
        current.events.upsert(item.id, {
          kind: "agent",
          title: codexItemActivity(item)?.title || "Subagente",
          meta: {
            threads: ids.length,
            background: true,
            ...(item.model ? { model: String(item.model) } : {}),
          },
        });
      }
      function updateAgentStates(item) {
        for (const [threadId, state] of Object.entries(item.agentsStates || {})) {
          const id = current.subThreads?.get(threadId);
          if (!id) continue;
          if (state?.message) current.events.upsert(id, { text: state.message });
          if (["completed", "shutdown", "interrupted", "errored", "notFound"].includes(state?.status))
            current.events.finish(id, ["errored", "notFound", "interrupted"].includes(state.status) ? "error" : "done");
        }
        if (item.type === "subAgentActivity") {
          const id = current.subThreads?.get(item.agentThreadId);
          if (id && ["completed", "interrupted"].includes(item.kind))
            current.events.finish(id, item.kind === "completed" ? "done" : "error");
        }
      }
      function handle(ev) {
        if (ev.id !== undefined && !ev.method) {
          const pending = current.requests.get(ev.id);
          if (pending) {
            current.requests.delete(ev.id);
            ev.error
              ? pending.reject(new Error(ev.error.message || "Falha no Codex."))
              : pending.resolve(ev.result);
          }
          return;
        }
        if (ev.id !== undefined && ev.method) {
          if (/requestApproval$/.test(ev.method)) {
            const request = ev.params || {};
            if (request.threadId && request.threadId !== current.nativeId && !current.subThreads?.has(request.threadId)) {
              send({ id: ev.id, result: { decision: "decline" } });
              return;
            }
            const decide = async () => {
              const { options, native } = codexApprovalOptions(
                ev.method,
                request,
              );
              // Sem broker a resposta é imediata (negada), sem passar por uma volta assíncrona.
              const decision = approvals
                ? await askApproval(approvals, {
                    sessionId,
                    providerId: "codex",
                    tool: ev.method,
                    input: request,
                    options,
                    native,
                  })
                : { allow: false };
              if (!child.killed && child.exitCode === null) {
                const result =
                  ev.method === "item/permissions/requestApproval"
                    ? {
                        permissions: decision.allow
                          ? request.permissions || {}
                          : {},
                        scope: "turn",
                      }
                    : decision.cancelled
                  ? { decision: "cancel" }
                  : decision.native || {
                      decision: decision.allow ? "accept" : "decline",
                    };
                send({ id: ev.id, result });
              }
            };
            void decide().catch(() => close(sessionId));
          } else if (ev.method === "item/tool/requestUserInput")
            send({ id: ev.id, result: { answers: {} } });
          else
            send({
              id: ev.id,
              error: {
                code: -32601,
                message: "Solicitação interativa não suportada.",
              },
            });
          return;
        }
        const params = ev.params || {};
        if (params.threadId && params.threadId !== current.nativeId) {
          // Conversa de um subagente: as etapas dela entram aninhadas sob o agente que a lançou.
          const parentId = current.subThreads?.get(params.threadId);
          if (parentId) handleSubThreadItem(ev.method, params, parentId);
          return;
        }
        if (params.turnId && current.turnId && params.turnId !== current.turnId)
          return;
        if (ev.method === "turn/started") {
          current.turnId = params.turn?.id;
          if (!current.finish && !current.compaction) startAutoTurn();
        }
        else if (ev.method === "item/agentMessage/delta") {
          const id = params.itemId;
          current.messages.set(
            id,
            (current.messages.get(id) || "") + (params.delta || ""),
          );
          publish();
        } else if (ev.method === "item/commandExecution/outputDelta") {
          current.commands.set(
            params.itemId,
            (current.commands.get(params.itemId) || "") + (params.delta || ""),
          );
          emit("cli-stream-chunk", {
            sessionId,
            responseMessageId: current.responseMessageId,
            activity: "Recebendo saída do comando…",
            pid: child.pid,
          });
          output(params.delta || "", params.itemId);
        } else if (ev.method === "thread/tokenUsage/updated") {
          const usage = codexContext(params.tokenUsage);
          if (usage) current.context.update(usage);
        } else if (ev.method === "thread/compacted") {
          markCompacted(current);
        } else if (ev.method === "item/started") {
          if (params.item?.type === "contextCompaction")
            current.context.compacting(true);
          if (params.item?.type === "commandExecution")
            output(`$ ${params.item.command}\r\n`, params.item.id);
          const label = codexItemActivity(params.item);
          if (label) {
            // Uma atividade do subagente atualiza o agente original; não cria um agente por mensagem.
            if (params.item.type === "subAgentActivity" && current.subThreads?.has(params.item.agentThreadId)) {
              updateAgentStates(params.item);
              return;
            }
            sendActivity(label.activity, label.detail);
            current.events.upsert(params.item.id, {
              kind: label.kind,
              title: label.title,
              detail: label.detail,
              status: "running",
              ...(label.note ? { meta: { note: label.note } } : {}),
            });
            learnSubThreads(params.item);
            updateAgentStates(params.item);
          }
        } else if (
          ev.method === "item/reasoning/textDelta" ||
          ev.method === "item/reasoning/summaryTextDelta"
        ) {
          // Resumo e conteúdo são fluxos separados: o texto exibido é o conteúdo, ou o resumo se
          // não houver (nunca os dois misturados).
          const parts = (current.reasoningParts ||= new Map()).get(
            params.itemId,
          ) || { summary: "", content: "" };
          parts[
            ev.method.endsWith("summaryTextDelta") ? "summary" : "content"
          ] += params.delta || "";
          current.reasoningParts.set(params.itemId, parts);
          current.events.setText(
            params.itemId,
            parts.content || parts.summary,
            {
              kind: "reasoning",
              title: "Raciocínio",
            },
          );
          current.reasoning = (
            (current.reasoning || "") + (params.delta || "")
          ).slice(-2000);
          const at = Date.now();
          if (!current.reasoningAt || at - current.reasoningAt >= 120) {
            current.reasoningAt = at;
            sendActivity("Raciocinando…", reasoningTail(current.reasoning));
          }
        } else if (ev.method === "item/reasoning/summaryPartAdded") {
          const parts = current.reasoningParts?.get(params.itemId);
          if (parts?.summary) parts.summary += "\n\n";
        } else if (ev.method === "item/mcpToolCall/progress") {
          sendActivity("Ferramenta MCP em andamento…", params.message);
          // Só atualiza uma etapa conhecida: progresso de item desconhecido não cria etapa sem título.
          if (current.events.get(params.itemId))
            current.events.upsert(params.itemId, { detail: params.message });
        } else if (ev.method === "turn/plan/updated") {
          sendActivity("Atualizando o plano…", params.explanation);
          current.events.upsert("plan", {
            kind: "plan",
            title: "Plano",
            text: planText(params.plan, params.explanation),
          });
        } else if (ev.method === "item/completed") {
          const item = params.item || {};
          if (item.type === "reasoning") current.reasoning = "";
          if (item.type === "contextCompaction") {
            sendActivity("Contexto compactado");
            markCompacted(current);
          }
          const label = codexItemActivity(item);
          if (label && item.id) {
            if (item.type === "subAgentActivity" && current.subThreads?.has(item.agentThreadId)) {
              updateAgentStates(item);
              return;
            }
            learnSubThreads(item);
            if (!current.events.get(item.id))
              current.events.upsert(item.id, {
                kind: label.kind,
                title: label.title,
                detail: label.detail,
              });
            const failed =
              ["failed", "declined"].includes(item.status) || !!item.error;
            const runningAgent = label.kind === "agent" && !failed && current.events.get(item.id)?.meta?.background;
            if (!runningAgent) current.events.finish(item.id, failed ? "error" : "done", {
              ...(label.detail ? { detail: label.detail } : {}),
              ...(Number.isFinite(item.durationMs)
                ? { durationMs: item.durationMs }
                : {}),
              ...(item.type === "commandExecution" &&
              Number.isFinite(item.exitCode)
                ? { exitCode: item.exitCode }
                : {}),
              ...(item.type === "reasoning"
                ? {
                    text:
                      textOf(item.content) ||
                      textOf(item.summary) ||
                      current.events.get(item.id)?.text,
                  }
                : {}),
              ...(item.type === "plan" ? { text: item.text } : {}),
              ...(item.error
                ? {
                    detail:
                      item.error.message ||
                      (typeof item.error === "string" ? item.error : "Falha."),
                  }
                : {}),
            });
            updateAgentStates(item);
          }
          if (item.type === "agentMessage") {
            current.messages.set(item.id, item.text || "");
            publish();
          }
          if (item.type === "commandExecution") {
            completeCommand(item.id, item);
          }
        } else if (ev.method === "turn/completed") {
          const turn = params.turn || {};
          // Fim de OUTRO turno (ex.: a compactação manual) ou fora de turno: não encerra a resposta atual.
          if (
            (turn.id && current.turnId && turn.id !== current.turnId) ||
            !current.finish
          ) {
            settleCompaction(current);
            return;
          }
          current.events.finishRunning(
            turn.status === "completed" ? "done" : "error",
          );
          current.finish?.({
            ok: turn.status === "completed",
            output: current.text,
            error:
              turn.status === "completed"
                ? undefined
                : turn.error?.message || `Codex: ${turn.status || "falha"}`,
          });
        } else if (ev.method === "error" && !params.willRetry) {
          current.error = params.error?.message || "Falha no Codex.";
        }
      }
      const decoder = new StringDecoder("utf8");
      child.stdout.on("data", (chunk) => {
        current.buffer += decoder.write(chunk);
        if (current.buffer.length > 16 * 1024 * 1024) {
          current.finish?.({
            ok: false,
            error: "Saída do Codex excedeu o limite.",
          });
          close(sessionId);
          return;
        }
        const lines = current.buffer.split("\n");
        current.buffer = lines.pop();
        for (const line of lines)
          try {
            handle(JSON.parse(line));
          } catch {}
      });
      const stderrFilter = createStderrFilter({
        forward: output,
        onAuthError: onMcpAuthError,
      });
      child.stderr.on("data", (chunk) => {
        const value = chunk.toString();
        current.stderr = (current.stderr + value).slice(-16000);
        stderrFilter(value);
      });
      child.stdin.on("error", (error) =>
        current.finish?.({ ok: false, error: error.message }),
      );
      child.on("error", (error) =>
        current.finish?.({ ok: false, error: error.message }),
      );
      child.on("close", (code) => {
        // Pedidos de permissão pendentes não sobrevivem ao app-server que os fez.
        approvals?.cancelSession(sessionId);
        if (entries.get(sessionId) === current) entries.delete(sessionId);
        for (const pending of current.requests.values())
          pending.reject(new Error("O Codex encerrou a conexão."));
        current.requests.clear();
        current.finish?.({
          ok: false,
          error: current.error || current.stderr || `Codex encerrou (${code}).`,
        });
      });
      current.ready = (async () => {
        await request("initialize", {
          clientInfo: {
            name: "beagledock",
            title: "BeagleDock",
            version: require("../package.json").version,
          },
        });
        send({ method: "initialized" });
        const result = await request(
          nativeId ? "thread/resume" : "thread/start",
          {
            ...(nativeId ? { threadId: nativeId } : {}),
            cwd,
            developerInstructions: LIVE_OUTPUT_GUIDANCE,
            ...(model ? { model } : {}),
            ...(permission !== "inherit"
              ? {
                  approvalPolicy:
                    approvals && permission === "edits"
                      ? "on-request"
                      : "never",
                  sandbox: ["plan", "ask"].includes(permission)
                    ? "read-only"
                    : permission === "full"
                      ? "danger-full-access"
                      : "workspace-write",
                }
              : {}),
          },
        );
        const actual = result.thread?.id;
        if (
          typeof actual !== "string" ||
          !/^[a-zA-Z0-9_-]{8,160}$/.test(actual)
        )
          throw new Error("O Codex não informou o ID da conversa.");
        if (nativeId && actual !== nativeId)
          throw new Error("O Codex abriu outra conversa durante a retomada.");
        current.nativeId = actual;
        await store.setNativeSession(sessionId, "codex", actual, cwd);
      })();
      current.ready.catch(() => {});
    }
    const current = e;
    try {
      await current.ready;
    } catch (error) {
      close(sessionId);
      return { ok: false, error: error.message };
    }
    if (entries.get(sessionId) !== current)
      return { ok: false, cancelled: true, error: "Execução interrompida." };
    // Compactação manual em curso: espera terminar para os eventos dela não caírem neste turno.
    if (current.compaction) await current.compaction.promise;
    if (current.autoDone) await current.autoDone;
    if (entries.get(sessionId) !== current)
      return { ok: false, cancelled: true, error: "Execução interrompida." };
    current.messages.clear();
    current.commands.clear();
    current.turnId = null;
    current.text = "";
    current.error = null;
    current.responseMessageId = responseMessageId;
    current.reasoningParts = new Map();
    current.subThreads ||= new Map();
    current.events.start(responseMessageId);
    return new Promise((resolve) => {
      let done = false;
      const timer =
        turnTimeout > 0
          ? setTimeout(() => {
              current.finish({
                ok: false,
                error: "Tempo limite da execução. A conversa permanece salva.",
              });
              close(sessionId);
            }, turnTimeout)
          : undefined;
      current.finish = (result) => {
        if (done) return;
        done = true;
        if (result.output === undefined && current.text)
          result = { ...result, output: current.text };
        clearTimeout(timer);
        current.finish = null;
        current.events.finishRunning(result.ok ? "done" : "error");
        const turnEvents = current.events.snapshot();
        current.events.endTurn();
        resolve({
          ...result,
          events: turnEvents,
          context: current.context.hasData()
            ? current.context.snapshot()
            : undefined,
          pid: current.child.pid,
          nativeSessionId: current.nativeId,
        });
      };
      current
        .request("turn/start", {
          threadId: current.nativeId,
          input: p.input || [{ type: "text", text: p.prompt }],
          ...(effort ? { effort } : {}),
          ...(model ? { model } : {}),
          cwd,
        })
        .then((result) => {
          if (!done) current.turnId = result.turn?.id || current.turnId;
        })
        .catch((error) =>
          current.finish?.({ ok: false, error: error.message }),
        );
    });
  }
  // Mensagem enviada durante a execução: `turn/steer` a entrega ao turno ativo (como o Enter durante
  // a resposta na CLI do Codex). Devolve false quando não há turno em andamento compatível ou o
  // Codex recusa (ex.: o turno acabou no meio); aí a mensagem espera na fila.
  function canInject(p) {
    const e = entries.get(p?.sessionId);
    return !(
      !e ||
      !e.finish ||
      !e.turnId ||
      !e.nativeId ||
      e.compaction ||
      e.child.exitCode !== null ||
      e.child.killed ||
      e.selection !== p.selection ||
      e.cwd !== p.cwd
    );
  }
  async function inject(p) {
    const e = entries.get(p?.sessionId);
    if (
      !e ||
      !e.finish ||
      !e.turnId ||
      !e.nativeId ||
      e.compaction ||
      e.child.exitCode !== null ||
      e.child.killed ||
      e.selection !== p.selection ||
      e.cwd !== p.cwd
    )
      return false;
    try {
      await e.request("turn/steer", {
        threadId: e.nativeId,
        expectedTurnId: e.turnId,
        input: p.input,
      });
      return true;
    } catch {
      return false;
    }
  }
  // Compactação nativa do Codex (thread/compact/start): só com o app-server da conversa ativo e
  // ocioso. Espera a compactação terminar e devolve o contexto resultante (para ser salvo).
  async function compact(id, { timeoutMs = 120000 } = {}) {
    const e = entries.get(id);
    if (!e || !e.nativeId || e.child.exitCode !== null || e.child.killed)
      return {
        ok: false,
        error:
          "Envie uma mensagem ao Codex antes de compactar: a conversa ainda não está ativa.",
      };
    if (e.finish)
      return { ok: false, error: "Aguarde o fim da execução para compactar." };
    if (e.compaction) return { ok: false, error: "A conversa já está sendo compactada." };
    // Fora de turno os eventos não pertencem à resposta anterior.
    e.responseMessageId = undefined;
    e.events.start(undefined);
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    e.compaction = { promise, resolve, timer: setTimeout(() => settleCompaction(e), timeoutMs) };
    e.manualCompaction = true;
    e.context.compacting(true);
    try {
      await e.request("thread/compact/start", { threadId: e.nativeId });
    } catch (error) {
      settleCompaction(e);
      return { ok: false, error: error.message };
    }
    await promise;
    return { ok: true, context: e.context.hasData() ? e.context.snapshot() : undefined };
  }
  return {
    execute,
    inject,
    canInject,
    compact,
    kill: close,
    shutdown() {
      for (const id of entries.keys()) close(id);
    },
    async prepareUpdate() {
      const children = [...entries.values()].map((e) => e.child);
      for (const id of entries.keys()) close(id);
      await Promise.all(
        children
          .filter((c) => c.exitCode === null)
          .map(
            (c) =>
              new Promise((resolve, reject) => {
                const t = setTimeout(
                  () => reject(new Error("Codex ainda está encerrando.")),
                  3000,
                );
                c.once("close", () => {
                  clearTimeout(t);
                  resolve();
                });
              }),
          ),
      );
    },
  };
}
module.exports = { createCodexStream };
