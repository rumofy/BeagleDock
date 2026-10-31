const { StringDecoder } = require("string_decoder");
const path = require("path");
const { findBinary, spawnCli, validCwd, terminateCli } = require("./platform");
const {
  agyPermissionSettings,
  readInheritedPermissions,
} = require("./agy-permissions");

const { createLiveFiles, liveDirectories } = require("./live-files");
const { createAgyChildOutput } = require("./agy-child-output");
const { createCodexStream } = require("./codex-stream");
const { saveAttachments, findMentions, buildInput, dataRoot } = require("./attachments");
const {
  claudeToolActivity,
  reasoningTail,
  oneLine,
  bufferingNote,
} = require("./activity-labels");
const { LIVE_OUTPUT_GUIDANCE } = require("./guidance");
const { randomUUID } = require("crypto");
const { createEventTracker } = require("./stream-events");
const {
  claudeContextUsed,
  pickModelWindow,
  createContextTracker,
} = require("./context-usage");
const { askApproval, claudeApprovalOptions } = require("./approval-options");
const PROVIDERS = new Set(["claude", "codex", "antigravity"]);
const PERMISSIONS = new Set(["inherit", "plan", "ask", "edits", "full"]);

function buildArgs({
  providerId,
  nativeId,
  model,
  effort,
  permission = "edits",
  agySettings = undefined,
  interactive = false,
}) {
  const readonly =
    permission === "plan" || permission === "ask" || effort === "plan";
  let args;
  if (providerId === "codex") {
    args = nativeId
      ? ["exec", "resume", "--json", "--skip-git-repo-check"]
      : ["exec", "--json", "--skip-git-repo-check"];
    const sandbox = readonly
      ? "read-only"
      : permission === "full"
        ? "danger-full-access"
        : "workspace-write";
    if (permission !== "inherit")
      args.push(
        "-c",
        `sandbox_mode="${sandbox}"`,
        "-c",
        'approval_policy="never"',
      );
    if (model) args.push("-m", model);
    if (effort && effort !== "plan")
      args.push("-c", `model_reasoning_effort="${effort}"`);
    if (nativeId) args.push(nativeId);
    args.push("-"); // stdin prevents a prompt beginning with '-' becoming a CLI option
  } else {
    args = [
      ...(providerId === "claude" ? ["-p"] : []),
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
    ];
    if (model) args.push("--model", model);
    if (effort && effort !== "plan") args.push("--effort", effort);
    if (providerId === "claude") {
      args.push(
        "--append-system-prompt",
        LIVE_OUTPUT_GUIDANCE,
        "--verbose",
        "--include-partial-messages",
        "--permission-prompts",
        interactive ? "host" : "none",
      );
      if (interactive) args.push("--permission-prompt-tool", "stdio");
      if (permission === "full" && !readonly)
        args.push("--dangerously-skip-permissions");
      else if (permission !== "inherit")
        args.push("--permission-mode", readonly ? "plan" : "acceptEdits");
      if (nativeId) args.push("--resume", nativeId);
    } else {
      if (permission !== "inherit")
        args.push(
          "--mode",
          readonly ? "plan" : "accept-edits",
          "--settings",
          JSON.stringify(
            agySettings ||
              agyPermissionSettings(readonly ? "plan" : permission),
          ),
        );
      if (permission === "full" && !readonly)
        args.push("--dangerously-skip-permissions");
      if (nativeId) args.push("--conversation", nativeId);
    }
  }
  return args;
}

function createCliRunner({
  store,
  emit = () => {},
  onComplete = () => {},
  find = findBinary,
  spawn = spawnCli,
  checkCwd = validCwd,
  // 0 = sem limite: execuções longas e sessões em segundo plano nunca são encerradas por tempo.
  turnTimeout = 0,
  resolveSelection = ({ model, effort }) => ({ model, effort }),
  readAgyPermissions = readInheritedPermissions,
  globalFingerprint = () => "",
  approvals,
  onMcpAuthError = () => {},
  // Atualizações de eventos depois do fim do turno (agentes em segundo plano).
  onLateEvents = () => {},
  // Turno espontâneo da CLI (o agente principal recebeu o resultado de um agente em segundo plano
  // e responde sozinho): o app o guarda e avisa, em vez de descartar.
  onAutoTurn = () => {},
  // Pasta onde os anexos de cada conversa são gravados.
  attachmentsRoot = dataRoot(),
}) {
  const codex = createCodexStream({
    spawn,
    store,
    emit,
    turnTimeout,
    approvals,
    onMcpAuthError,
    onLateEvents,
    onAutoTurn,
  });
  const processes = new Map();
  const busy = new Set();
  const cancelled = new Set();
  let closed = false;
  // `shellId` é o id do evento da linha do tempo do comando ou da ferramenta que produziu a saída;
  // sem ele, a saída não pôde ser atribuída a uma origem e fica só na visão geral.
  const output = (sessionId, data, pid, shellId) =>
    emit("pty-data", { sessionId, data, pid, ...(shellId ? { shellId } : {}) });
  function kill(sessionId) {
    approvals?.cancelSession(sessionId);
    codex.kill(sessionId);
    if (busy.has(sessionId)) cancelled.add(sessionId);
    const entry = processes.get(sessionId);
    if (!entry) return;
    processes.delete(sessionId);
    entry.approvalBridge?.close();
    void entry.liveFiles?.stop();
    if (entry.turn)
      entry.turn.finish({
        ok: false,
        cancelled: true,
        output: entry.turn.text,
        error: "Execução interrompida.",
      });
    try {
      entry.child.stdin.end();
      terminateCli(entry.child);
    } catch {}
  }
  async function execute(payload) {
    const {
      sessionId,
      providerId,
      prompt,
      model: requestedModel = "",
      effort: requestedEffort = "",
      permission = "edits",
    } = payload || {};
    if (closed) return { ok: false, error: "Executor encerrado." };
    if (
      typeof sessionId !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,200}$/.test(sessionId) ||
      !PROVIDERS.has(providerId) ||
      typeof prompt !== "string" ||
      !prompt.trim()
    )
      return { ok: false, error: "Sessão, provedor ou mensagem inválidos." };
    if (
      !PERMISSIONS.has(permission) ||
      typeof requestedEffort !== "string" ||
      (requestedEffort !== "" &&
        !/^[a-z][a-z0-9_-]{0,40}$/i.test(requestedEffort)) ||
      typeof requestedModel !== "string" ||
      requestedModel.length > 200
    )
      return { ok: false, error: "Modelo, permissão ou esforço inválidos." };
    if (busy.has(sessionId))
      return {
        ok: false,
        error: "Esta conversa já tem uma execução em andamento.",
      };
    busy.add(sessionId);
    cancelled.delete(sessionId);
    try {
      const { model, effort } = resolveSelection({
        providerId,
        model: requestedModel,
        effort: requestedEffort,
      });
      const cwd = checkCwd(payload.cwd);
      const bin =
        providerId === "antigravity"
          ? find("agy") || find("antigravity")
          : find(providerId);
      if (!bin)
        throw new Error(
          `CLI ${providerId} não encontrada. Instale e autentique a ferramenta na máquina.`,
        );
      const link = await store.getNativeSession(sessionId, providerId);
      if (link && link.cwd !== cwd)
        throw new Error(
          "Esta conversa pertence a outro diretório. Crie uma nova sessão para trocar de projeto.",
        );
      if (cancelled.has(sessionId) || closed)
        return { ok: false, cancelled: true, error: "Execução interrompida." };
      const nativeId = link?.nativeId;
      // Anexos e @arquivos viram a entrada nativa de cada CLI; o que a CLI não suporta vira aviso.
      const built = buildInput(providerId, {
        prompt,
        files: saveAttachments({
          sessionId,
          attachments: payload.attachments,
          root: attachmentsRoot,
        }),
        mentions: findMentions(prompt, cwd),
      });
      if (built.warnings.length)
        emit("cli-notice", {
          sessionId,
          responseMessageId: payload.responseMessageId,
          message: built.warnings.join(" "),
        });
      if (providerId === "codex")
        return await codex.execute({
          ...payload,
          input: built.input,
          bin,
          cwd,
          model,
          effort,
          permission,
          nativeId,
          fingerprint: globalFingerprint(providerId),
        });
      const agySettings =
        providerId === "antigravity" && permission !== "inherit"
          ? agyPermissionSettings(permission, readAgyPermissions(), !!approvals)
          : undefined;
      const key = JSON.stringify([
        providerId,
        bin,
        cwd,
        model,
        effort,
        permission,
        agySettings,
        globalFingerprint(providerId),
      ]);
      let entry = processes.get(sessionId);
      if (
        entry &&
        (entry.key !== key ||
          entry.child.exitCode !== null ||
          entry.child.killed)
      ) {
        kill(sessionId);
        entry = null;
      }
      if (!entry) {
        const args = buildArgs({
          providerId,
          nativeId,
          model,
          effort,
          permission,
          agySettings,
          interactive: !!approvals,
        });
        let approvalBridge;
        if (providerId === "antigravity" && approvals) {
          approvalBridge =
            await require("./agy-approval-bridge").createAgyApprovalBridge({
              sessionId,
              permission,
              ask: approvals.ask,
              getNativeId: () => processes.get(sessionId)?.nativeId,
              onConversation: (id) => processes.get(sessionId)?.watchConversation?.(id),
            });
          if (cancelled.has(sessionId) || closed) {
            approvalBridge.close();
            return {
              ok: false,
              cancelled: true,
              error: "Execução interrompida.",
            };
          }
        }
        const child = spawn(bin, args, {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
          ...(approvalBridge ? { env: approvalBridge.env } : {}),
        });
        entry = {
          approvalBridge,
          child,
          key,
          providerId,
          nativeId,
          turn: null,
          buffer: "",
          stderr: "",
          idWrite: Promise.resolve(),
          persistenceError: null,
        };
        processes.set(sessionId, entry);
        const current = entry;
        const activity = (text, detail) =>
          emit("cli-stream-chunk", {
            sessionId,
            responseMessageId: current.turn?.responseMessageId,
            activity: text,
            ...(detail ? { detail } : {}),
            pid: child.pid,
          });
        current.activity = activity;
        current.events = createEventTracker({
          emit,
          sessionId,
          pid: () => child.pid,
          onLate: onLateEvents,
        });
        current.blocks = new Map();
        current.eventSeq = 0;
        current.context = createContextTracker({
          emit,
          sessionId,
          source: providerId,
        });
        const decoder = new StringDecoder("utf8");
        const startLiveFiles = (id, baseline) => {
          if (current.liveFiles) {
            if (providerId === "antigravity" && id !== current.nativeId && !current.childOutputs.has(id)) {
              current.childOutputs.set(id, createAgyChildOutput({
                onCommand: (command, key) => {
                  activity("Executando comando…", oneLine(command));
                  output(sessionId, `$ ${command}\r\n`, child.pid, `child-${id}-${key}`);
                },
                onOutput: (text, key) => {
                  activity("Recebendo saída do comando…");
                  output(
                    sessionId,
                    text,
                    child.pid,
                    key ? `child-${id}-${key}` : undefined,
                  );
                },
                onToolStart: ({ id: key, name, command, args: toolArgs }) => {
                  if (["send_message", "manage_inbox"].includes(name)) return;
                  const parentId =
                    current.childAgents?.get(id) || current.lastAgentStepId;
                  const isCommand = typeof command === "string" && command.length > 0;
                  current.events.upsert(`child-${id}-${key}`, {
                    kind: isCommand ? "command" : "tool",
                    title: String(name || "tool"),
                    detail: oneLine(
                      command ||
                        (toolArgs ? JSON.stringify(toolArgs) : ""),
                    ),
                    ...(bufferingNote(command)
                      ? { meta: { note: bufferingNote(command) } }
                      : {}),
                    ...(parentId ? { parentId } : {}),
                  });
                },
                onToolEnd: ({ id: key, status, error }) => {
                  const eventId = `child-${id}-${key}`;
                  if (current.events.get(eventId))
                    current.events.finish(eventId, status, {
                      ...(error ? { detail: oneLine(error) } : {}),
                    });
                },
                onFinish: () => {
                  const parentId = current.childAgents?.get(id);
                  if (parentId && current.events.get(parentId))
                    current.events.finish(parentId, "done");
                },
                hasLiveOutput: (step) => current.childLiveSteps.has(`${id}:${step}`),
              }));
              const directories = liveDirectories(providerId, id, cwd).map((d) => ({ ...d, conversationId: id }));
              if (directories.length) directories.push({ ...directories[0], dir: path.join(path.dirname(directories[0].dir), "logs"), pattern: /^transcript\.jsonl$/ });
              void current.liveFiles.addDirectories(directories);
            }
            return;
          }
          current.childAgents = new Map();
          current.childOutputs = new Map();
          current.childLiveSteps = new Set();
          current.liveOutputSteps = new Set();
          current.liveTexts = new Map();
          current.liveTaskIds = new Set();
          current.liveFiles = createLiveFiles({
            directories: liveDirectories(providerId, id, cwd),
            baseline,
            onData: (data, meta) => {
              if (meta.conversationId && meta.file === "transcript.jsonl") {
                current.childOutputs.get(meta.conversationId)?.(data);
                return;
              }
              if (meta.conversationId && meta.stepIndex)
                current.childLiveSteps.add(`${meta.conversationId}:${meta.stepIndex}`);
              if (meta.stepIndex && !meta.conversationId) {
                current.liveOutputSteps.add(Number(meta.stepIndex));
                current.liveTaskIds.add(`task-${meta.stepIndex}`);
              }
              if (providerId === "claude" && current.tools?.size === 1) {
                const id = [...current.tools][0];
                const old = current.liveTexts.get(id) || "";
                if (old.length < 1024 * 1024)
                  current.liveTexts.set(id, old + data);
              }
              current.hasLiveOutput = true;
              activity("Recebendo saída do comando…");
              // Antigravity: o log da tarefa é do passo. Claude: só dá para atribuir com uma
              // ferramenta em andamento; com várias, a origem é ambígua e não é inventada.
              const liveShell =
                meta.stepIndex && !meta.conversationId
                  ? `step-${meta.stepIndex}`
                  : providerId === "claude" &&
                      current.tools?.size === 1 &&
                      current.events.get([...current.tools][0])?.kind === "command"
                    ? [...current.tools][0]
                    : undefined;
              output(sessionId, data, child.pid, liveShell);
            },
          });
        };
        current.watchConversation = (id) => startLiveFiles(id, false);
        if (nativeId) startLiveFiles(nativeId, true);
        const setNativeId = (id) => {
          if (
            typeof id !== "string" ||
            !/^[a-zA-Z0-9_-]{8,160}$/.test(id) ||
            id === current.nativeId ||
            current.childAgents?.has(id) ||
            current.childOutputs?.has(id)
          )
            return;
          if (current.nativeId) {
            current.persistenceError =
              "A CLI abriu outra conversa durante a retomada. Execução interrompida para preservar a sessão.";
            child.kill();
            return;
          }
          current.nativeId = id;
          startLiveFiles(id, false);
          current.idWrite = store
            .setNativeSession(sessionId, providerId, id, cwd)
            .catch((err) => {
              current.persistenceError = `Não foi possível persistir a conversa: ${err.message}`;
              child.kill();
            });
        };
        const stream = (text, delta = false) => {
          const turn = current.turn;
          if (!turn || !text) return;
          if (delta) {
            turn.text += text;
            turn.hasDeltas = true;
          } else if (!turn.hasDeltas)
            turn.text += (turn.text ? "\n\n" : "") + text;
          emit("cli-stream-chunk", {
            sessionId,
            responseMessageId: turn.responseMessageId,
            activity: "IA respondendo…",
            chunk: text,
            fullText: turn.text,
            pid: child.pid,
          });
        };
        function startAutoTurn(ev) {
          const id = `auto-${randomUUID()}`;
          const model = ev.message?.model || ev.event?.message?.model || current.model;
          let resolveDone;
          const auto = {
            text: "",
            responseMessageId: id,
            hasDeltas: false,
            auto: true,
            model,
            done: new Promise((r) => (resolveDone = r)),
          };
          auto.finish = async (result) => {
            if (auto.finished) return;
            auto.finished = true;
            current.turn = null;
            await current.liveFiles?.poll().catch(() => {});
            current.events.finishRunning(result.ok ? "done" : "error");
            const events = current.events.snapshot();
            current.events.endTurn();
            const text = String(result.output || auto.text || "");
            const payload = {
              sessionId,
              providerId,
              responseMessageId: id,
              ok: !!result.ok,
              text,
              error: result.error,
              events,
              model,
              // Sem texto nem erro não há o que mostrar (ex.: só ferramentas): descarta a mensagem.
              discard: !text.trim() && !result.error,
              context: current.context.hasData() ? current.context.snapshot() : undefined,
            };
            emit("cli-turn-finished", payload);
            try {
              onAutoTurn(payload);
            } finally {
              resolveDone();
            }
          };
          current.events.start(id);
          current.turn = auto;
          emit("cli-turn-started", { sessionId, responseMessageId: id, providerId, model });
        }
        const handle = (ev) => {
          setNativeId(
            ev.session_id ||
              ev.conversation_id ||
              ev.conversationId ||
              ev.thread_id ||
              ev.result?.session_id ||
              ev.result?.conversation_id,
          );
          // Turno espontâneo do Claude Code: conteúdo do agente principal sem nenhuma mensagem sua em
          // andamento. Etapas internas de subagentes (parent_tool_use_id) não começam turno.
          if (
            !current.turn &&
            providerId === "claude" &&
            !ev.parent_tool_use_id &&
            ((ev.type === "stream_event" && ev.event?.type === "message_start") ||
              ev.type === "assistant")
          )
            startAutoTurn(ev);
          const turn = current.turn;
          // AGY uses event/step_update/result, distinct from Claude's type envelope.
          if (providerId === "antigravity" && typeof ev.event === "string") {
            if (ev.event === "step_update") {
              const step = ev.step_update || {};
              setNativeId(step.conversation_id);
              // O AGY informa o uso de cada chamada ao modelo (verificado com a CLI real, 1.4.12):
              // a entrada de uma chamada já inclui todo o histórico, então é o contexto ocupado.
              // A janela do modelo não é informada pela CLI.
              if (
                step.step_type === "agent_response" &&
                step.state === "DONE" &&
                Number.isFinite(step.usage?.input_tokens) &&
                step.usage.input_tokens > 0
              )
                current.context.update({ used: step.usage.input_tokens });
              if (
                step.step_type === "agent_response" &&
                typeof step.text_delta === "string"
              )
                stream(step.text_delta, true);
              // user_input e system_message são ruído para a pessoa (o pedido e o prompt de sistema).
              if (
                step.step_type &&
                !["agent_response", "user_input", "system_message"].includes(
                  step.step_type,
                )
              ) {
                const info = step.tool_info || {};
                const id = `step-${step.step_index}`;
                const isTool = step.step_type === "tool";
                const command =
                  info.parameters?.CommandLine || info.parameters?.command;
                const name =
                  info.name ||
                  info.tool_name ||
                  info.tool ||
                  step.tool_name ||
                  String(step.step_type).toLowerCase();
                const isSubagent =
                  step.step_type === "subagent" ||
                  /subagent/i.test(String(name));
                if (isSubagent) current.lastAgentStepId = id;
                const spawned = Array.isArray(step.subagent_info?.subagents)
                  ? step.subagent_info.subagents
                  : [];
                for (const sub of spawned) {
                  if (typeof sub?.conversation_id === "string") {
                    current.childAgents ||= new Map();
                    current.childAgents.set(sub.conversation_id, id);
                    startLiveFiles(sub.conversation_id, false);
                  }
                }
                if (!current.events.get(id))
                  current.events.upsert(id, {
                    kind: isSubagent
                      ? "agent"
                      : command
                        ? "command"
                        : isTool
                          ? "tool"
                          : "step",
                    title: isTool || isSubagent ? String(name) : String(step.step_type),
                    ...(bufferingNote(command)
                      ? { meta: { note: bufferingNote(command) } }
                      : {}),
                    detail: oneLine(
                      command ||
                        spawned[0]?.initial_prompt ||
                        (info.parameters
                          ? JSON.stringify(info.parameters)
                          : step.text || ""),
                    ),
                  });
                else if (spawned[0]?.initial_prompt)
                  current.events.upsert(id, {
                    detail: oneLine(spawned[0].initial_prompt),
                  });
                // invoke_subagent retorna DONE ao criar o agente em segundo plano; ele continua ativo
                // até entregar a mensagem de conclusão ou encerrar o turno.
                if (step.state === "DONE" && (!isSubagent || info.error || !spawned.length))
                  current.events.finish(id, info.error ? "error" : "done", {
                    ...(info.error
                      ? { detail: oneLine(info.error.message || "Falha.") }
                      : {}),
                  });
              }
              if (step.step_type === "tool") {
                current.agyTools ||= new Map();
                const previous = current.agyTools.get(step.step_index);
                const info = step.tool_info || {};
                // manage_task devolve a saída de um comando assíncrono: o TaskId termina em `task-N`, em que
                // N é o passo do run_command que o iniciou, e a saída pertence à aba desse comando.
                const taskStep = /\/?task-(\d+)$/.exec(
                  String(info.parameters?.TaskId || ""),
                )?.[1];
                const command =
                  info.parameters?.CommandLine || info.parameters?.command;
                // Só comandos têm shell; ler arquivo, MCP e outras ferramentas ficam só na visão geral.
                const shellId =
                  command || taskStep
                    ? `step-${taskStep ?? step.step_index}`
                    : undefined;
                if (command && !previous) {
                  activity("Executando comando…", oneLine(command));
                  output(sessionId, `$ ${command}\r\n`, child.pid, shellId);
                }
                const value =
                  typeof info.output === "string" ? info.output : "";
                const old = previous?.output || "";
                if (
                  value &&
                  value !== old &&
                  !current.liveOutputSteps?.has(step.step_index) &&
                  !current.liveTaskIds?.has(info.parameters?.TaskId)
                )
                  output(
                    sessionId,
                    value.startsWith(old) ? value.slice(old.length) : value,
                    child.pid,
                    shellId,
                  );
                if (step.state === "DONE" && previous?.state !== "DONE") {
                  if (value) output(sessionId, "\r\n", child.pid, shellId);
                  if (info.error)
                    output(
                      sessionId,
                      `Erro: ${info.error.message || "Falha na ferramenta."}\r\n`,
                      child.pid,
                      shellId,
                    );
                }
                current.agyTools.set(step.step_index, {
                  state: step.state,
                  output: value || old,
                });
              }
            } else if (ev.event === "result" && turn) {
              const result = ev.result || {};
              const ok = result.status === "SUCCESS";
              const error =
                typeof result.error === "string"
                  ? result.error
                  : result.error?.message;
              current.agyTools?.clear();
              turn.finish({
                ok,
                output:
                  typeof result.response === "string"
                    ? result.response
                    : turn.text,
                error: ok
                  ? undefined
                  : error ||
                    `AGY finalizou com status ${result.status || "desconhecido"}.`,
              });
            } else if (ev.event === "error" && turn) {
              turn.finish({
                ok: false,
                error:
                  typeof ev.error === "string"
                    ? ev.error
                    : ev.error?.message || "Falha no AGY.",
              });
            }
            return;
          }
          if (ev.type === "control_request") {
            const request = ev.request || {};
            const response = async () => {
              let decision = { allow: false };
              if (request.subtype === "can_use_tool" && approvals) {
                // Opções nativas do Claude Code (permission_suggestions): "permitir sempre", pasta, modo…
                const { options, native } = claudeApprovalOptions(request);
                decision = await askApproval(approvals, {
                  sessionId,
                  providerId,
                  tool: request.display_name || request.tool_name,
                  input: request.input,
                  options,
                  native,
                });
              }
              if (child.killed || child.exitCode !== null) return;
              child.stdin.write(
                JSON.stringify({
                  type: "control_response",
                  response: {
                    subtype: "success",
                    request_id: ev.request_id,
                    response: decision.allow
                      ? {
                          behavior: "allow",
                          updatedInput: request.input || {},
                          ...(decision.native?.updatedPermissions
                            ? {
                                updatedPermissions:
                                  decision.native.updatedPermissions,
                              }
                            : {}),
                        }
                      : {
                          behavior: "deny",
                          message:
                            decision.message ||
                            "Ação não autorizada pelo usuário.",
                        },
                  },
                }) + "\n",
              );
            };
            void response().catch(() => kill(sessionId));
          } else if (ev.type === "system") {
            if (ev.subtype === "compact_boundary") {
              const id = `compact-${++current.eventSeq}`;
              current.events.upsert(id, {
                kind: "compaction",
                title: "Compactação de contexto",
                detail: oneLine(ev.compact_metadata?.trigger || ""),
              });
              current.events.finish(id);
              activity("Contexto compactado");
              current.context.compacted({
                pre: ev.compact_metadata?.pre_tokens,
                post: ev.compact_metadata?.post_tokens,
                trigger: ev.compact_metadata?.trigger,
              });
            } else if (
              ev.subtype === "task_started" &&
              ev.tool_use_id &&
              ev.task_type &&
              ev.task_type !== "local_agent" &&
              !ev.subagent_type
            ) {
              // Comando em segundo plano (Bash) também abre uma tarefa, mas não é um agente: segue
              // como comando e não entra na contagem de agentes.
              if (current.events.get(ev.tool_use_id))
                current.events.upsert(ev.tool_use_id, {
                  meta: { taskId: ev.task_id },
                });
            } else if (ev.subtype === "task_started" && ev.tool_use_id) {
              // Ciclo de tarefa do subagente (Claude Code 2.1.316, verificado): o `Agent` lançado
              // aparece como uma etapa de agente, e as etapas internas ficam aninhadas nela.
              current.events.upsert(ev.tool_use_id, {
                kind: "agent",
                title: `Agente ${ev.subagent_type || ""}`.trim(),
                detail: oneLine(ev.description),
                meta: {
                  taskId: ev.task_id,
                  subagentType: ev.subagent_type,
                  ...(ev.is_backgrounded === true ? { background: true } : {}),
                },
              });
              activity(
                `Agente ${ev.subagent_type || ""}`.trim(),
                oneLine(ev.description),
              );
            } else if (ev.subtype === "task_progress" && ev.tool_use_id) {
              current.events.upsert(ev.tool_use_id, {
                detail: oneLine(ev.description),
                meta: {
                  tokens: ev.usage?.total_tokens,
                  toolUses: ev.usage?.tool_uses,
                  durationMs: ev.usage?.duration_ms,
                  lastTool: ev.last_tool_name,
                },
              });
            } else if (ev.subtype === "task_notification" && ev.tool_use_id) {
              current.events.finish(
                ev.tool_use_id,
                ev.status === "completed" ? "done" : "error",
                {
                  text: oneLine(ev.summary, 600),
                  meta: {
                    tokens: ev.usage?.total_tokens,
                    toolUses: ev.usage?.tool_uses,
                    durationMs: ev.usage?.duration_ms,
                  },
                },
              );
            } else if (ev.subtype === "thinking_tokens") {
              // O Claude Code não expõe o texto do raciocínio (chega vazio), mas informa a
              // contagem estimada de tokens: é progresso real, visível na etapa e na atividade.
              const id = [...current.blocks.values()]
                .filter((v) => v.startsWith("think-"))
                .at(-1);
              const detail = `~${Number(ev.estimated_tokens) || 0} tokens de raciocínio`;
              if (id) current.events.upsert(id, { detail });
              activity("Raciocinando…", detail);
            } else if (ev.subtype === "status" && ev.status === "compacting") {
              current.events.upsert("compacting", {
                kind: "compaction",
                title: "Compactação de contexto",
              });
              activity("Compactando o contexto…");
              current.context.compacting(true);
            } else if (
              ev.subtype === "status" &&
              current.events.get("compacting")
            ) {
              current.events.finish("compacting");
              current.context.compacting(false);
            }
          } else if (ev.type === "stream_event") {
            const delta = ev.event?.delta;
            if (delta?.type === "text_delta") stream(delta.text, true);
            if (
              ev.event?.type === "content_block_start" &&
              ev.event.content_block?.type === "thinking"
            ) {
              current.thinking = "";
              activity("Raciocinando…");
              const id = `think-${++current.eventSeq}`;
              current.blocks.set(ev.event.index, id);
              current.events.upsert(id, {
                kind: "reasoning",
                title: "Raciocínio",
              });
            }
            if (delta?.type === "thinking_delta")
              current.events.appendText(
                current.blocks.get(ev.event.index),
                delta.thinking,
              );
            if (ev.event?.type === "content_block_stop") {
              const id = current.blocks.get(ev.event.index);
              if (id) {
                current.events.finish(id);
                current.blocks.delete(ev.event.index);
              }
            }
            if (delta?.type === "thinking_delta") {
              current.thinking = (
                (current.thinking || "") + (delta.thinking || "")
              ).slice(-2000);
              const at = Date.now();
              if (!current.thinkingAt || at - current.thinkingAt >= 120) {
                current.thinkingAt = at;
                activity("Raciocinando…", reasoningTail(current.thinking));
              }
            }
            if (
              ev.event?.type === "content_block_start" &&
              ev.event.content_block?.type === "tool_use"
            ) {
              activity(
                `Preparando ${ev.event.content_block.name || "ferramenta"}…`,
              );
              const label = claudeToolActivity(ev.event.content_block);
              current.events.upsert(ev.event.content_block.id, {
                kind: label.kind,
                title: label.title,
              });
            }
            if (
              ev.event?.type === "content_block_start" &&
              ev.event.content_block?.type === "text" &&
              turn?.text
            )
              turn.text += "\n\n";
          } else if (ev.type === "assistant") {
            if (providerId === "claude" && !ev.parent_tool_use_id) {
              const used = claudeContextUsed(ev.message?.usage);
              if (used !== null) {
                current.model = ev.message?.model || current.model;
                current.context.update({
                  used,
                  window: current.contextWindow,
                  windowKnown: Number.isFinite(current.contextWindow),
                  model: current.model,
                });
              }
            }
            for (const block of ev.message?.content || []) {
              if (block.type === "text") stream(block.text);
              if (block.type === "tool_use") {
                current.tools ||= new Set();
                current.tools.add(block.id);
                const label = claudeToolActivity(block);
                activity(label.activity, label.detail);
                current.events.upsert(block.id, {
                  kind: label.kind,
                  title: label.title,
                  detail: label.detail,
                  ...(label.note || block.input?.run_in_background
                    ? {
                        meta: {
                          ...(label.note ? { note: label.note } : {}),
                          ...(label.kind === "agent" && block.input?.run_in_background
                            ? { background: true }
                            : {}),
                        },
                      }
                    : {}),
                  ...(ev.parent_tool_use_id
                    ? { parentId: ev.parent_tool_use_id }
                    : {}),
                });
                const command =
                  block.input?.command ||
                  block.input?.description ||
                  block.name;
                output(
                  sessionId,
                  `$ ${command}\r\n`,
                  child.pid,
                  current.events.get(block.id)?.kind === "command" ? block.id : undefined,
                );
              }
            }
            if (turn) turn.hasDeltas = false;
          } else if (ev.type === "user") {
            for (const block of ev.message?.content || []) {
              // A chamada de um agente em segundo plano volta na hora ("Async agent launched"):
              // ele continua rodando até a notificação final da tarefa.
              if (
                block.type === "tool_result" &&
                !current.events.get(block.tool_use_id)?.meta?.background
              )
                current.events.finish(
                  block.tool_use_id,
                  block.is_error ? "error" : "done",
                );
              if (
                block.type !== "tool_result" ||
                !current.tools?.has(block.tool_use_id)
              )
                continue;
              current.tools.delete(block.tool_use_id);
              let text =
                typeof block.content === "string"
                  ? block.content
                  : (block.content || []).map((c) => c.text || "").join("\n");
              const seen = current.liveTexts?.get(block.tool_use_id);
              if (seen && text.startsWith(seen)) text = text.slice(seen.length);
              current.liveTexts?.delete(block.tool_use_id);
              if (text)
                output(
                  sessionId,
                  text.slice(0, 16000) + "\r\n",
                  child.pid,
                  current.events.get(block.tool_use_id)?.kind === "command"
                    ? block.tool_use_id
                    : undefined,
                );
            }
          } else if (
            ev.type === "item.completed" &&
            ev.item?.type === "agent_message"
          )
            stream(ev.item.text);
          else if (
            ev.type === "item.started" &&
            ev.item?.type === "command_execution"
          )
            output(sessionId, `$ ${ev.item.command}\r\n`, child.pid, ev.item.id);
          else if (
            ["item.updated", "item.completed"].includes(ev.type) &&
            ev.item?.type === "command_execution"
          ) {
            current.commandOutputs ||= new Map();
            const old = current.commandOutputs.get(ev.item.id) || "";
            const text = String(ev.item.aggregated_output || "");
            if (text !== old)
              output(
                sessionId,
                text.startsWith(old) ? text.slice(old.length) : text,
                child.pid,
                ev.item.id,
              );
            if (ev.type === "item.completed") {
              output(sessionId, "\r\n", child.pid, ev.item.id);
              current.commandOutputs.delete(ev.item.id);
            } else current.commandOutputs.set(ev.item.id, text);
          } else if (ev.type === "error" || ev.type === "turn.failed") {
            if (turn)
              turn.error =
                ev.error?.message || ev.message || "A CLI informou uma falha.";
          } else if (ev.type === "result" && turn) {
            if (providerId === "claude") {
              const window = pickModelWindow(ev.modelUsage, current.model);
              if (window) {
                current.contextWindow = window;
                current.context.setWindow(window, true);
              }
            }
            const resultText =
              typeof ev.result === "string" ? ev.result : ev.result?.text;
            turn.finish({
              ok: !ev.is_error && !turn.error,
              output: resultText || turn.text,
              error: ev.is_error
                ? (ev.errors || []).join("\n") || resultText || "Falha na CLI."
                : turn.error,
            });
          }
        };
        const consume = (text) => {
          current.buffer += text;
          if (current.buffer.length > 16 * 1024 * 1024) {
            current.persistenceError = "Resposta da CLI excedeu o limite.";
            child.kill();
            return;
          }
          const lines = current.buffer.split("\n");
          current.buffer = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              handle(JSON.parse(line));
            } catch {
              output(sessionId, line.slice(0, 2000) + "\r\n", child.pid);
            }
          }
        };
        child.stdout.on("data", (chunk) => consume(decoder.write(chunk)));
        child.stderr.on("data", (chunk) => {
          const text = chunk.toString();
          current.stderr = (current.stderr + text).slice(-16000);
          output(sessionId, text, child.pid);
        });
        child.stdin.on("error", (error) => {
          current.turn?.finish({ ok: false, error: error.message });
        });
        child.on("error", (error) =>
          current.turn?.finish({ ok: false, error: error.message }),
        );
        child.on("close", (code) => {
          consume(decoder.end() + "\n");
          current.approvalBridge?.close();
          approvals?.cancelSession(sessionId);
          void current.liveFiles?.stop();
          if (processes.get(sessionId) === current) processes.delete(sessionId);
          const turn = current.turn;
          if (turn)
            turn.finish({
              ok: code === 0 && !turn.error,
              code,
              output: turn.text,
              error:
                turn.error ||
                (code === 0
                  ? undefined
                  : current.stderr.trim() ||
                    `CLI encerrou com código ${code}.`),
            });
        });
      }
      // Um turno espontâneo em andamento termina antes de a mensagem nova usar a CLI.
      if (entry.turn?.auto) await entry.turn.done;
      return await new Promise((resolve) => {
        const current = entry;
        let finished = false;
        const timer =
          turnTimeout > 0
            ? setTimeout(() => {
                current.turn?.finish({
                  ok: false,
                  error:
                    "Tempo limite da execução. A conversa permanece salva.",
                });
                kill(sessionId);
              }, turnTimeout)
            : undefined;
        current.events.start(payload.responseMessageId);
        current.turn = {
          text: "",
          responseMessageId: payload.responseMessageId,
          hasDeltas: false,
          finish: async (result) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            const turn = current.turn;
            current.turn = null;
            await current.liveFiles?.poll();
            await current.idWrite;
            if (current.persistenceError)
              result = { ok: false, error: current.persistenceError };
            if (result.ok && !current.nativeId) {
              result = {
                ok: false,
                error:
                  "A CLI não informou o ID da conversa. Atualize a ferramenta antes de continuar.",
                output: result.output || turn?.text,
              };
              kill(sessionId);
            }
            if (!current.nativeId) kill(sessionId);
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
          },
        };
        try {
          current.activity?.("Aguardando a CLI…");
          if (providerId === "codex") current.child.stdin.end(built.text);
          else
            current.child.stdin.write(
              JSON.stringify(
                providerId === "antigravity"
                  ? { event: "user", message: { content: built.text } }
                  : {
                      type: "user",
                      message: { role: "user", content: built.content },
                    },
              ) + "\n",
            );
        } catch (error) {
          current.turn?.finish({ ok: false, error: error.message });
          kill(sessionId);
        }
      });
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      busy.delete(sessionId);
      cancelled.delete(sessionId);
      Promise.resolve(onComplete()).catch(() => {});
    }
  }
  return {
    execute,
    kill,
    isBusy: (id) => (id === undefined ? busy.size > 0 : busy.has(id)),
    busyCount: () => busy.size,
    // Compactação nativa: só o Codex tem comando próprio fora da conversa; no Claude Code é a
    // mensagem /compact, e o AGY não oferece compactação em modo programático.
    compact: (id, providerId) =>
      providerId === "codex"
        ? codex.compact(id)
        : Promise.resolve({
            ok: false,
            error:
              providerId === "antigravity"
                ? "O AGY não oferece compactação em modo programático."
                : "No Claude Code a compactação é a mensagem /compact.",
          }),
    async prepareUpdate() {
      await codex.prepareUpdate();
      if (busy.size)
        throw new Error("Aguarde as respostas terminarem antes de atualizar.");
      await Promise.all(
        [...processes.entries()].map(
          ([id, entry]) =>
            new Promise((resolve, reject) => {
              if (entry.child.exitCode !== null) {
                kill(id);
                resolve();
                return;
              }
              const timer = setTimeout(
                () =>
                  reject(
                    new Error("A CLI ainda está encerrando. Tente novamente."),
                  ),
                3000,
              );
              entry.child.once("close", () => {
                clearTimeout(timer);
                resolve();
              });
              kill(id);
            }),
        ),
      );
    },
    shutdown: () => {
      closed = true;
      approvals?.shutdown();
      codex.shutdown();
      for (const id of processes.keys()) kill(id);
    },
  };
}
module.exports = { createCliRunner, buildArgs };
