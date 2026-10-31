const { StringDecoder } = require("string_decoder");
const { findBinary, spawnCli, validCwd, terminateCli } = require("./platform");
const {
  agyPermissionSettings,
  readInheritedPermissions,
} = require("./agy-permissions");

const { createLiveFiles, liveDirectories } = require("./live-files");
const { createCodexStream } = require("./codex-stream");
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
        "BeagleDock displays your text and terminal output live. For long-running commands such as tests, builds and installs, preserve incremental stdout/stderr: run the command directly. Do not pipe it through tail, collect it in command substitution, or redirect all output to a file and read it only after completion unless the user explicitly requests that behavior. Summarize the result in chat after the command finishes. This guidance does not grant permissions or override project instructions.",
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
  turnTimeout = 15 * 60 * 1000,
  resolveSelection = ({ model, effort }) => ({ model, effort }),
  readAgyPermissions = readInheritedPermissions,
  globalFingerprint = () => "",
  approvals,
}) {
  const codex = createCodexStream({
    spawn,
    store,
    emit,
    turnTimeout,
    approvals,
  });
  const processes = new Map();
  const busy = new Set();
  const cancelled = new Set();
  let closed = false;
  const output = (sessionId, data, pid) =>
    emit("pty-data", { sessionId, data, pid });
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
      if (providerId === "codex")
        return await codex.execute({
          ...payload,
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
        const activity = (text) =>
          emit("cli-stream-chunk", {
            sessionId,
            responseMessageId: current.turn?.responseMessageId,
            activity: text,
            pid: child.pid,
          });
        current.activity = activity;
        const decoder = new StringDecoder("utf8");
        const startLiveFiles = (id, baseline) => {
          if (current.liveFiles) return;
          current.liveOutputSteps = new Set();
          current.liveTexts = new Map();
          current.liveTaskIds = new Set();
          current.liveFiles = createLiveFiles({
            directories: liveDirectories(providerId, id, cwd),
            baseline,
            onData: (data, meta) => {
              if (meta.stepIndex) {
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
              output(sessionId, data, child.pid);
            },
          });
        };
        if (nativeId) startLiveFiles(nativeId, true);
        const setNativeId = (id) => {
          if (
            typeof id !== "string" ||
            !/^[a-zA-Z0-9_-]{8,160}$/.test(id) ||
            id === current.nativeId
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
        const handle = (ev) => {
          setNativeId(
            ev.session_id ||
              ev.conversation_id ||
              ev.conversationId ||
              ev.thread_id ||
              ev.result?.session_id ||
              ev.result?.conversation_id,
          );
          const turn = current.turn;
          // AGY uses event/step_update/result, distinct from Claude's type envelope.
          if (providerId === "antigravity" && typeof ev.event === "string") {
            if (ev.event === "step_update") {
              const step = ev.step_update || {};
              setNativeId(step.conversation_id);
              if (
                step.step_type === "agent_response" &&
                typeof step.text_delta === "string"
              )
                stream(step.text_delta, true);
              if (step.step_type === "tool") {
                current.agyTools ||= new Map();
                const previous = current.agyTools.get(step.step_index);
                const info = step.tool_info || {};
                const command =
                  info.parameters?.CommandLine || info.parameters?.command;
                if (command && !previous) {
                  activity("CLI executando ferramenta…");
                  output(sessionId, `$ ${command}\r\n`, child.pid);
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
                  );
                if (step.state === "DONE" && previous?.state !== "DONE") {
                  if (value) output(sessionId, "\r\n", child.pid);
                  if (info.error)
                    output(
                      sessionId,
                      `Erro: ${info.error.message || "Falha na ferramenta."}\r\n`,
                      child.pid,
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
              const allow =
                request.subtype === "can_use_tool" && approvals
                  ? await approvals.ask({
                      sessionId,
                      providerId,
                      tool: request.tool_name,
                      input: request.input,
                    })
                  : false;
              if (child.killed || child.exitCode !== null) return;
              child.stdin.write(
                JSON.stringify({
                  type: "control_response",
                  response: {
                    subtype: "success",
                    request_id: ev.request_id,
                    response: allow
                      ? { behavior: "allow", updatedInput: request.input || {} }
                      : {
                          behavior: "deny",
                          message: "Ação não autorizada pelo usuário.",
                        },
                  },
                }) + "\n",
              );
            };
            void response().catch(() => kill(sessionId));
          } else if (ev.type === "stream_event") {
            const delta = ev.event?.delta;
            if (delta?.type === "text_delta") stream(delta.text, true);
            if (
              ev.event?.type === "content_block_start" &&
              ev.event.content_block?.type === "text" &&
              turn?.text
            )
              turn.text += "\n\n";
          } else if (ev.type === "assistant") {
            for (const block of ev.message?.content || []) {
              if (block.type === "text") stream(block.text);
              if (block.type === "tool_use") {
                current.tools ||= new Set();
                current.tools.add(block.id);
                activity(`CLI: ${block.name || "ferramenta"}`);
                const command =
                  block.input?.command ||
                  block.input?.description ||
                  block.name;
                output(sessionId, `$ ${command}\r\n`, child.pid);
              }
            }
            if (turn) turn.hasDeltas = false;
          } else if (ev.type === "user") {
            for (const block of ev.message?.content || []) {
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
                output(sessionId, text.slice(0, 16000) + "\r\n", child.pid);
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
            output(sessionId, `$ ${ev.item.command}\r\n`, child.pid);
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
              );
            if (ev.type === "item.completed") {
              output(sessionId, "\r\n", child.pid);
              current.commandOutputs.delete(ev.item.id);
            } else current.commandOutputs.set(ev.item.id, text);
          } else if (ev.type === "error" || ev.type === "turn.failed") {
            if (turn)
              turn.error =
                ev.error?.message || ev.message || "A CLI informou uma falha.";
          } else if (ev.type === "result" && turn) {
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
      return await new Promise((resolve) => {
        const current = entry;
        let finished = false;
        const timer = setTimeout(() => {
          current.turn?.finish({
            ok: false,
            error: "Tempo limite da execução. A conversa permanece salva.",
          });
          kill(sessionId);
        }, turnTimeout);
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
            resolve({
              ...result,
              pid: current.child.pid,
              nativeSessionId: current.nativeId,
            });
          },
        };
        try {
          current.activity?.("Aguardando a CLI…");
          if (providerId === "codex") current.child.stdin.end(prompt);
          else
            current.child.stdin.write(
              JSON.stringify(
                providerId === "antigravity"
                  ? { event: "user", message: { content: prompt } }
                  : {
                      type: "user",
                      message: { role: "user", content: prompt },
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
