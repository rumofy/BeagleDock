const { StringDecoder } = require("string_decoder");
const { terminateCli } = require("./platform");
function createCodexStream({
  spawn,
  store,
  emit = () => {},
  turnTimeout = 900000,
  approvals,
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
        child,
        requests: new Map(),
        nativeId,
        text: "",
        messages: new Map(),
        commands: new Map(),
        stderr: "",
        buffer: "",
        turnId: null,
      };
      entries.set(sessionId, e);
      const current = e;
      const output = (data) =>
        emit("pty-data", { sessionId, data, pid: child.pid });
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
            if (request.threadId && request.threadId !== current.nativeId) {
              send({ id: ev.id, result: { decision: "decline" } });
              return;
            }
            const decide = async () => {
              const allow = approvals
                ? await approvals.ask({
                    sessionId,
                    providerId: "codex",
                    tool: ev.method,
                    input: request,
                  })
                : false;
              if (!child.killed && child.exitCode === null) {
                const result =
                  ev.method === "item/permissions/requestApproval"
                    ? {
                        permissions: allow ? request.permissions || {} : {},
                        scope: "turn",
                      }
                    : { decision: allow ? "accept" : "decline" };
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
        if (params.threadId && params.threadId !== current.nativeId) return;
        if (params.turnId && current.turnId && params.turnId !== current.turnId)
          return;
        if (ev.method === "turn/started") current.turnId = params.turn?.id;
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
          output(params.delta || "");
        } else if (
          ev.method === "item/started" &&
          params.item?.type === "commandExecution"
        )
          output(`$ ${params.item.command}\r\n`);
        else if (ev.method === "item/completed") {
          const item = params.item || {};
          if (item.type === "agentMessage") {
            current.messages.set(item.id, item.text || "");
            publish();
          }
          if (item.type === "commandExecution") {
            const received = current.commands.get(item.id) || "",
              full = item.aggregatedOutput || "";
            if (full && full !== received) {
              if (full.startsWith(received))
                output(full.slice(received.length));
              else if (received && full.endsWith(received))
                output(
                  "\r\n[Início da saída]\r\n" + full.slice(0, -received.length),
                );
              else if (!received) output(full);
            }
            output("\r\n");
            current.commands.delete(item.id);
          }
        } else if (ev.method === "turn/completed") {
          const turn = params.turn || {};
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
      child.stderr.on("data", (chunk) => {
        const value = chunk.toString();
        current.stderr = (current.stderr + value).slice(-16000);
        output(value);
      });
      child.stdin.on("error", (error) =>
        current.finish?.({ ok: false, error: error.message }),
      );
      child.on("error", (error) =>
        current.finish?.({ ok: false, error: error.message }),
      );
      child.on("close", (code) => {
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
    current.messages.clear();
    current.commands.clear();
    current.turnId = null;
    current.text = "";
    current.error = null;
    current.responseMessageId = responseMessageId;
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        current.finish({
          ok: false,
          error: "Tempo limite da execução. A conversa permanece salva.",
        });
        close(sessionId);
      }, turnTimeout);
      current.finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        current.finish = null;
        resolve({
          ...result,
          pid: current.child.pid,
          nativeSessionId: current.nativeId,
        });
      };
      current
        .request("turn/start", {
          threadId: current.nativeId,
          input: [{ type: "text", text: p.prompt }],
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
  return {
    execute,
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
