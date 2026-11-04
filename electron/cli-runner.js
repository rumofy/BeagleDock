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
const {
  SEGMENT_SEPARATOR,
  addRotation,
  liveReply,
  applyRotations,
} = require("./message-segments");
const { createEventTracker } = require("./stream-events");
const {
  claudeContextUsed,
  claudeCacheUsage,
  claudeCacheTtl,
  agyCacheUsage,
  pickModelWindow,
  createContextTracker,
} = require("./context-usage");
const {
  DEFAULT_AUTO_COMPACT_TOKENS,
  resolveAutoCompactForWindow,
} = require("./auto-compact");
const { askApproval, approvalKind, claudeApprovalOptions } = require("./approval-options");
const { t } = require("./i18n");
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
      else {
        if (permission !== "inherit")
          args.push("--permission-mode", readonly ? "plan" : "acceptEdits");
        // Only enables (doesn't turn on) the no-confirmation mode: without it Claude Code refuses switching
        // to "Full access" during the session (set_permission_mode, verified in 2.1.316).
        if (interactive) args.push("--allow-dangerously-skip-permissions");
      }
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

// Where the conversation goes when the plan is approved: keeps "Full access" if it was already chosen
// (including during the wait); otherwise, "Accept edits", like the shortcut that turns plan off.
function planExit(entry) {
  const permission = entry.permission === "full" ? "full" : "edits";
  return { permission, mode: permission === "full" ? "bypassPermissions" : "acceptEdits" };
}

function createCliRunner({
  store,
  emit = () => {},
  onComplete = () => {},
  find = findBinary,
  spawn = spawnCli,
  checkCwd = validCwd,
  // 0 = no limit: long runs and background sessions are never stopped by time.
  turnTimeout = 0,
  resolveSelection = ({ model, effort }) => ({ model, effort }),
  readAgyPermissions = readInheritedPermissions,
  globalFingerprint = () => "",
  // Context limit for compacting on its own (0 = off). Read on every turn: a change applies right away.
  getAutoCompactTokens = () => DEFAULT_AUTO_COMPACT_TOKENS,
  approvals,
  onMcpAuthError = () => {},
  // Event updates after the end of the turn (background agents).
  onLateEvents = () => {},
  // The CLI's spontaneous turn (the main agent got the result of a background agent
  // and replies on its own): the app keeps it and notifies, instead of discarding it.
  onAutoTurn = () => {},
  // Folder where each conversation's attachments are saved.
  attachmentsRoot = dataRoot(),
}) {
  // Each model's window, learned from the replies: the automatic compaction limit depends on it.
  const knownWindows = new Map();
  const windowKey = (providerId, model) => `${providerId}:${model || ""}`;
  const autoCompactFor = (providerId, model) =>
    resolveAutoCompactForWindow(getAutoCompactTokens(), knownWindows.get(windowKey(providerId, model)));
  const codex = createCodexStream({
    onWindow: (model, window) => knownWindows.set(windowKey("codex", model), window),
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
  // `shellId` is the id of the timeline event of the command or tool that produced the output;
  // without it, the output couldn't be attributed to a source and stays only in the overview.
  const output = (sessionId, data, pid, shellId) =>
    emit("pty-data", { sessionId, data, pid, ...(shellId ? { shellId } : {}) });
  // `restart`: the run itself swaps the process (level, model or effort changed). It doesn't mark the
  // message that's starting as cancelled; before, in AGY it ended as "Run stopped".
  function kill(sessionId, { restart = false } = {}) {
    approvals?.cancelSession(sessionId);
    codex.kill(sessionId);
    if (busy.has(sessionId) && !restart) cancelled.add(sessionId);
    const entry = processes.get(sessionId);
    if (!entry) return;
    processes.delete(sessionId);
    for (const waiting of entry.controls?.values() || [])
      waiting.reject(new Error(t("errors.cliClosed")));
    entry.controls?.clear();
    entry.approvalBridge?.close();
    void entry.liveFiles?.stop();
    if (entry.turn)
      entry.turn.finish({
        ok: false,
        cancelled: true,
        output: entry.turn.text,
        error: t("errors.runStopped"),
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
    if (closed) return { ok: false, error: t("errors.runnerClosed") };
    if (
      typeof sessionId !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,200}$/.test(sessionId) ||
      !PROVIDERS.has(providerId) ||
      typeof prompt !== "string" ||
      !prompt.trim()
    )
      return { ok: false, error: t("errors.invalidRunRequest") };
    if (
      !PERMISSIONS.has(permission) ||
      typeof requestedEffort !== "string" ||
      (requestedEffort !== "" &&
        !/^[a-z][a-z0-9_-]{0,40}$/i.test(requestedEffort)) ||
      typeof requestedModel !== "string" ||
      requestedModel.length > 200
    )
      return { ok: false, error: t("errors.invalidRunOptions") };
    if (busy.has(sessionId))
      return {
        ok: false,
        error: t("errors.runAlreadyActive"),
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
          t("errors.cliMissingInstall", { id: providerId }),
        );
      const link = await store.getNativeSession(sessionId, providerId);
      if (link && link.cwd !== cwd)
        throw new Error(
          t("errors.otherDirectoryNewSession"),
        );
      if (cancelled.has(sessionId) || closed)
        return { ok: false, cancelled: true, error: t("errors.runStopped") };
      const nativeId = link?.nativeId;
      // Attachments and @files become each CLI's native input; what the CLI doesn't support becomes a notice.
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
          requestedModel,
          input: built.input,
          bin,
          cwd,
          model,
          effort,
          permission,
          nativeId,
          fingerprint: globalFingerprint(providerId),
          autoCompactTokens: autoCompactFor(providerId, requestedModel),
          autoCompactKey: getAutoCompactTokens() ?? "auto",
        });
      const agySettings =
        providerId === "antigravity" && permission !== "inherit"
          ? agyPermissionSettings(permission, readAgyPermissions(), !!approvals)
          : undefined;
      const autoCompactTokens = providerId === "claude" ? autoCompactFor(providerId, model) : 0;
      const fingerprint = globalFingerprint(providerId);
      // The permission is part of the key: changing it restarts the CLI on the next message, except when the
      // change was already applied live (setPermission updates the running process's key).
      const keyFor = (level, settings) =>
        JSON.stringify([
          providerId,
          bin,
          cwd,
          model,
          effort,
          level,
          settings,
          fingerprint,
          // The chosen value (not the one derived from the window): learning the window doesn't restart the CLI.
          getAutoCompactTokens() ?? "auto",
        ]);
      const key = keyFor(permission, agySettings);
      let entry = processes.get(sessionId);
      if (
        entry &&
        (entry.key !== key ||
          entry.child.exitCode !== null ||
          entry.child.killed)
      ) {
        kill(sessionId, { restart: true });
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
              error: t("errors.runStopped"),
            };
          }
        }
        const child = spawn(bin, args, {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
          ...(approvalBridge || autoCompactTokens
            ? {
                env: {
                  ...(approvalBridge?.env || {}),
                  ...(autoCompactTokens
                    ? { CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(autoCompactTokens) }
                    : {}),
                },
              }
            : {}),
        });
        entry = {
          approvalBridge,
          child,
          key,
          keyFor,
          model,
          effort,
          permission,
          controls: new Map(),
          controlSeq: 0,
          cwd,
          selection: JSON.stringify([model, effort, permission]),
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
            responseMessageId: liveReply(current.turn, current.turn?.text).responseMessageId,
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
          model: requestedModel,
        });
        const decoder = new StringDecoder("utf8");
        const startLiveFiles = (id, baseline) => {
          if (current.liveFiles) {
            if (providerId === "antigravity" && id !== current.nativeId && !current.childOutputs.has(id)) {
              current.childOutputs.set(id, createAgyChildOutput({
                onCommand: (command, key) => {
                  activity(t("activity.commandNow"), oneLine(command));
                  output(sessionId, `$ ${command}\r\n`, child.pid, `child-${id}-${key}`);
                },
                onOutput: (text, key) => {
                  activity(t("activity.commandOutput"));
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
              activity(t("activity.commandOutput"));
              // Antigravity: the task log belongs to the step. Claude: it can only be attributed with one
              // tool in progress; with several, the source is ambiguous and isn't made up.
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
              t("errors.cliOtherThread");
            child.kill();
            return;
          }
          current.nativeId = id;
          startLiveFiles(id, false);
          current.idWrite = store
            .setNativeSession(sessionId, providerId, id, cwd)
            .catch((err) => {
              current.persistenceError = t("errors.persistFailed", { error: err.message });
              child.kill();
            });
        };
        const stream = (text, delta = false, stepIndex = undefined) => {
          const turn = current.turn;
          if (!turn || !text) return;
          if (delta) {
            // AGY: each reply step is a part; the text of a new step opens another box.
            if (stepIndex !== undefined && turn.text && turn.textStep !== undefined && turn.textStep !== stepIndex)
              turn.text += SEGMENT_SEPARATOR;
            if (stepIndex !== undefined) turn.textStep = stepIndex;
            turn.text += text;
            turn.hasDeltas = true;
          } else if (!turn.hasDeltas)
            turn.text += (turn.text ? SEGMENT_SEPARATOR : "") + text;
          const live = liveReply(turn, turn.text);
          emit("cli-stream-chunk", {
            sessionId,
            responseMessageId: live.responseMessageId,
            activity: t("activity.aiReplying"),
            chunk: text,
            fullText: live.fullText,
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
              // No text and no error means nothing to show (e.g. only tools): discard the message.
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
          // Claude Code's spontaneous turn: main-agent content without any message of yours in
          // progress. Internal subagent steps (parent_tool_use_id) don't start a turn.
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
              // AGY reports the usage of each model call (verified with the real CLI, 1.4.12):
              // a call's input already includes the whole history, so it's the context in use.
              // The model's window isn't reported by the CLI.
              if (
                step.step_type === "agent_response" &&
                step.state === "DONE" &&
                Number.isFinite(step.usage?.input_tokens) &&
                step.usage.input_tokens > 0
              )
                current.context.update({
                  used: step.usage.input_tokens,
                  cache: agyCacheUsage(step.usage),
                });
              if (
                step.step_type === "agent_response" &&
                typeof step.text_delta === "string"
              )
                stream(step.text_delta, true, step.step_index);
              // user_input and system_message are noise for the person (the request and the system prompt).
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
                // invoke_subagent returns DONE when creating the background agent; it stays active
                // until it delivers the completion message or ends the turn.
                if (step.state === "DONE" && (!isSubagent || info.error || !spawned.length))
                  current.events.finish(id, info.error ? "error" : "done", {
                    ...(info.error
                      ? { detail: oneLine(info.error.message || t("activity.failed")) }
                      : {}),
                  });
              }
              if (step.step_type === "tool") {
                current.agyTools ||= new Map();
                const previous = current.agyTools.get(step.step_index);
                const info = step.tool_info || {};
                // manage_task returns the output of an async command: the TaskId ends in `task-N`, where
                // N is the step of the run_command that started it, and the output belongs to that command's tab.
                const taskStep = /\/?task-(\d+)$/.exec(
                  String(info.parameters?.TaskId || ""),
                )?.[1];
                const command =
                  info.parameters?.CommandLine || info.parameters?.command;
                // Only commands have a shell; reading files, MCP and other tools stay only in the overview.
                const shellId =
                  command || taskStep
                    ? `step-${taskStep ?? step.step_index}`
                    : undefined;
                if (command && !previous) {
                  activity(t("activity.commandNow"), oneLine(command));
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
                      `${t("session.errorPrefix")} ${info.error.message || t("errors.toolFailed")}\r\n`,
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
                // AGY's `result` joins the steps with "\n"; the turn's text keeps each part
                // separate (verified with the real CLI 1.4.12), so it applies when there's more than one.
                output: turn.text.includes(SEGMENT_SEPARATOR)
                  ? turn.text
                  : typeof result.response === "string"
                    ? result.response
                    : turn.text,
                error: ok
                  ? undefined
                  : error ||
                    t("errors.agyStatus", { status: result.status || t("common.unknown") }),
              });
            } else if (ev.event === "error" && turn) {
              turn.finish({
                ok: false,
                error:
                  typeof ev.error === "string"
                    ? ev.error
                    : ev.error?.message || t("errors.agyFailed"),
              });
            }
            return;
          }
          if (ev.type === "control_request") {
            const request = ev.request || {};
            const response = async () => {
              let decision = { allow: false };
              if (request.subtype === "can_use_tool" && approvals) {
                // Claude Code's native options (permission_suggestions): "always allow", folder, mode…
                const { options, native } = claudeApprovalOptions(request);
                decision = await askApproval(approvals, {
                  sessionId,
                  providerId,
                  // A plan or a question is a decision only the person makes: the UI shows it apart
                  // from permission requests, and switching to full access never answers it.
                  kind: approvalKind(request.tool_name),
                  tool: request.display_name || request.tool_name,
                  // The plan as text (JSON would escape the Markdown's line breaks).
                  input:
                    request.tool_name === "ExitPlanMode" && typeof request.input?.plan === "string"
                      ? request.input.plan
                      : request.input,
                  options,
                  native,
                });
              }
              if (child.killed || child.exitCode !== null) return;
              // Plan approved: Claude Code leaves plan mode in the mode the answer reports
              // (without it, it falls back to "default" and would ask for every edit). Verified in 2.1.316.
              const exitPlan = decision.allow && decision.native?.exitPlan ? planExit(current) : null;
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
                          ...(exitPlan
                            ? { updatedPermissions: [{ type: "setMode", mode: exitPlan.mode, destination: "session" }] }
                            : decision.native?.updatedPermissions
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
                            "Action not authorized by the user.",
                        },
                  },
                }) + "\n",
              );
              if (exitPlan) {
                // The conversation is no longer read-only: the next message doesn't restart the CLI
                // in plan mode, and the interface switches the level shown.
                current.permission = exitPlan.permission;
                current.key = current.keyFor(exitPlan.permission, undefined);
                current.selection = JSON.stringify([current.model, current.effort, exitPlan.permission]);
                emit("cli-permission-changed", { sessionId, permission: exitPlan.permission, reason: "plan-approved" });
              }
            };
            void response().catch(() => kill(sessionId));
          } else if (ev.type === "control_response") {
            // Answer to a command sent by the app (e.g. switching the permission mode live).
            const res = ev.response || {};
            const waiting = current.controls.get(res.request_id);
            if (waiting) {
              current.controls.delete(res.request_id);
              if (res.subtype === "success") waiting.resolve(res.response || {});
              else waiting.reject(new Error(res.error || t("errors.cliRefusedCommand")));
            }
          } else if (ev.type === "system") {
            if (ev.subtype === "compact_boundary") {
              const id = `compact-${++current.eventSeq}`;
              current.events.upsert(id, {
                kind: "compaction",
                title: t("activity.compaction"),
                detail: oneLine(ev.compact_metadata?.trigger || ""),
              });
              current.events.finish(id);
              activity(t("activity.compacted"));
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
              // A background command (Bash) also opens a task, but it isn't an agent: it goes on
              // as a command and doesn't count as an agent.
              if (current.events.get(ev.tool_use_id))
                current.events.upsert(ev.tool_use_id, {
                  meta: { taskId: ev.task_id },
                });
            } else if (ev.subtype === "task_started" && ev.tool_use_id) {
              // Subagent task cycle (Claude Code 2.1.316, verified): the launched `Agent`
              // shows as an agent step, and the internal steps are nested in it.
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
            } else if (
              ev.subtype === "task_updated" &&
              ev.patch?.is_backgrounded === true
            ) {
              // Command sent to the background mid-run ("Answer now" or the
              // CLI itself): the tool_result comes back right away, but the command keeps running until the
              // task_notification (Claude Code 2.1.317, verified with the real CLI).
              const command = current.events.find(
                (e) => e.meta?.taskId === ev.task_id,
              );
              if (command)
                current.events.upsert(command.id, {
                  meta: { ...command.meta, background: true },
                });
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
              // Claude Code doesn't expose the reasoning text (it arrives empty), but it reports the
              // estimated token count: it's real progress, visible in the step and the activity.
              const id = [...current.blocks.values()]
                .filter((v) => v.startsWith("think-"))
                .at(-1);
              const detail = t("activity.reasoningTokens", { count: Number(ev.estimated_tokens) || 0 });
              if (id) current.events.upsert(id, { detail });
              activity(t("activity.reasoningNow"), detail);
            } else if (ev.subtype === "status" && ev.status === "compacting") {
              current.events.upsert("compacting", {
                kind: "compaction",
                title: t("activity.compaction"),
              });
              activity(t("activity.compactionNow"));
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
                title: t("activity.reasoning"),
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
              turn.text += SEGMENT_SEPARATOR;
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
                  cache: claudeCacheUsage(ev.message?.usage),
                  cacheTtlMs: claudeCacheTtl(ev.message?.usage),
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
                  ...(label.text ? { text: label.text } : {}),
                  ...(label.note || label.proposal || block.input?.run_in_background
                    ? {
                        meta: {
                          ...(label.note ? { note: label.note } : {}),
                          ...(label.proposal ? { proposal: true } : {}),
                          ...(["agent", "command"].includes(label.kind) &&
                          block.input?.run_in_background
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
              // A background agent's call comes back right away ("Async agent launched"):
              // it keeps running until the task's final notification.
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
                ev.error?.message || ev.message || t("errors.cliReportedFailure");
          } else if (ev.type === "result" && turn) {
            // "Interrupt and answer": Claude Code closes the interrupted part with an error
            // result (error_during_execution, aborted_tools) and answers the delivered message right
            // after, in its own result (verified with the real CLI, 2.1.317). The turn stays
            // open until that second result.
            if (
              providerId === "claude" &&
              turn.answering &&
              ev.is_error &&
              ev.subtype === "error_during_execution"
            ) {
              turn.answering = false;
              // The interrupted step won't report its end again: close it as cancelled (commands
              // sent to the background keep running).
              current.events.finishRunning("error");
              return;
            }
            if (providerId === "claude") {
              const window = pickModelWindow(ev.modelUsage, current.model);
              if (window) {
                current.contextWindow = window;
                knownWindows.set(windowKey("claude", current.model), window);
                current.context.setWindow(window, true);
              }
            }
            const resultText =
              typeof ev.result === "string" ? ev.result : ev.result?.text;
            turn.finish({
              ok: !ev.is_error && !turn.error,
              // Claude's `result` carries only the last part (or the error message): what the AI already
              // wrote during the turn can't be replaced by it.
              output: ev.is_error
                ? turn.text
                : providerId === "claude"
                  ? turn.text || resultText
                  : resultText || turn.text,
              error: ev.is_error
                ? (ev.errors || []).join("\n") || resultText || t("errors.cliFailed")
                : turn.error,
            });
          }
        };
        const consume = (text) => {
          current.buffer += text;
          if (current.buffer.length > 16 * 1024 * 1024) {
            current.persistenceError = t("errors.cliReplyLimit");
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
          const finishing = turn
            ? turn.finish({
                ok: code === 0 && !turn.error,
                code,
                output: turn.text,
                error:
                  turn.error ||
                  (code === 0
                    ? undefined
                    : current.stderr.trim() ||
                      t("errors.cliExited", { code })),
              })
            : undefined;
          // Background tasks still listed as running ended together with the CLI.
          void Promise.resolve(finishing).then(() => current.events.finishAll());
        });
      }
      // A spontaneous turn in progress ends before the new message uses the CLI.
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
                    t("errors.runTimeout"),
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
            // A failure without its own output (process error, timeout, error event): what the AI already
            // wrote in the turn stays in the message.
            if (result.output === undefined && turn?.text)
              result = { ...result, output: turn.text };
            await current.liveFiles?.poll();
            await current.idWrite;
            if (current.persistenceError)
              result = { ok: false, error: current.persistenceError };
            if (result.ok && !current.nativeId) {
              result = {
                ok: false,
                error:
                  t("errors.cliNoThreadId"),
                output: result.output || turn?.text,
              };
              kill(sessionId);
            }
            if (!current.nativeId) kill(sessionId);
            current.events.finishRunning(result.ok ? "done" : "error");
            // With messages delivered midway, each reply carries its own steps.
            const rotated = turn?.rotations?.length;
            const turnEvents = rotated
              ? current.events.snapshotFor(turn.responseMessageId)
              : current.events.snapshot();
            result = applyRotations(result, turn);
            if (result.followUps)
              result.followUps = result.followUps.map((f) => ({
                ...f,
                events: current.events.snapshotFor(f.responseMessageId),
              }));
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
          current.activity?.(t("session.waitingCli"));
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
  // Claude Code: a message written during the run goes into the next step of the turn in progress
  // (tested with the real CLI: a single final reply covers both messages). Returns false when
  // there's no turn in progress with the same configuration; then the message waits in the queue.
  async function inject(payload) {
    const { sessionId, providerId, prompt, permission = "edits" } = payload || {};
    if (providerId === "codex") {
      if (typeof sessionId !== "string" || typeof prompt !== "string" || !prompt.trim())
        return false;
      try {
        const { model, effort } = resolveSelection({
          providerId,
          model: payload.model || "",
          effort: payload.effort || "",
        });
        const cwd = checkCwd(payload.cwd);
        const selection = JSON.stringify([model, effort, permission]);
        // Checks before saving the attachments: if injection isn't possible, `execute` saves them later.
        if (!codex.canInject({ sessionId, cwd, selection })) return false;
        const built = buildInput(providerId, {
          prompt,
          files: saveAttachments({
            sessionId,
            attachments: payload.attachments,
            root: attachmentsRoot,
          }),
          mentions: findMentions(prompt, cwd),
        });
        return await codex.inject({
          sessionId,
          cwd,
          selection,
          input: built.input,
          responseMessageId: payload.responseMessageId,
        });
      } catch {
        return false;
      }
    }
    if (
      providerId !== "claude" ||
      typeof sessionId !== "string" ||
      typeof prompt !== "string" ||
      !prompt.trim()
    )
      return false;
    const entry = processes.get(sessionId);
    if (
      !entry ||
      !entry.turn ||
      entry.turn.auto ||
      entry.providerId !== "claude" ||
      entry.child.exitCode !== null ||
      entry.child.killed ||
      !entry.child.stdin?.writable
    )
      return false;
    try {
      const { model, effort } = resolveSelection({
        providerId,
        model: payload.model || "",
        effort: payload.effort || "",
      });
      if (entry.selection !== JSON.stringify([model, effort, permission]))
        return false;
      const built = buildInput(providerId, {
        prompt,
        files: saveAttachments({
          sessionId,
          attachments: payload.attachments,
          root: attachmentsRoot,
        }),
        mentions: findMentions(prompt, entry.cwd),
      });
      entry.child.stdin.write(
        JSON.stringify({
          type: "user",
          message: { role: "user", content: built.content },
        }) + "\n",
      );
      // The reply that was receiving the text (the original or that of an earlier delivery) closes here.
      const from = liveReply(entry.turn, entry.turn.text).responseMessageId;
      const rotation = addRotation(entry.turn, {
        responseMessageId: payload.responseMessageId,
        text: entry.turn.text,
      });
      entry.events?.rotate(payload.responseMessageId);
      entry.activity?.(t("session.deliveredActivity"));
      return { from, at: rotation.at };
    } catch {
      return false;
    }
  }
  // "Answer now" for a message already delivered to the CLI that it hasn't read yet (the CLI reads it on the
  // next step, so it waits for the running command to finish).
  // - `background` (Claude Code): sends the running commands to the background; they
  //   keep running and the AI answers right away. With no command running, it falls back to `interrupt`.
  // - `interrupt`: interrupts the current step (the command is cancelled) and the AI answers next.
  // Codex: interrupts the turn and resends the delivered message in a new turn.
  async function answerNow({ sessionId, providerId, mode = "background" } = {}) {
    if (typeof sessionId !== "string") return { ok: false, error: t("errors.invalidConversation") };
    if (providerId === "codex") return codex.answerNow(sessionId);
    if (providerId !== "claude")
      return { ok: false, error: t("errors.cliReadsAtEnd") };
    const entry = processes.get(sessionId);
    if (!entry?.turn || entry.turn.auto || entry.providerId !== "claude" || !entry.child.stdin?.writable)
      return { ok: false, error: t("errors.noReplyRunning") };
    if (!entry.turn.rotations?.length)
      return { ok: false, error: t("errors.noDeliveredMessage") };
    try {
      if (mode === "background") {
        // Only commands Claude Code tracks as a task (task_started) can go to the
        // background; the ones already there stay as they are.
        const running = entry.events.filter(
          (e) =>
            e.kind === "command" &&
            e.status === "running" &&
            e.meta?.taskId &&
            e.meta?.background !== true,
        );
        let moved = 0;
        for (const command of running) {
          const response = await control(entry, { subtype: "background_tasks", tool_use_id: command.id });
          if (response?.backgrounded) moved++;
        }
        if (moved) {
          entry.activity?.(t("activity.backgroundAnswering"));
          return { ok: true, mode: "background", moved };
        }
      }
      entry.turn.answering = true;
      await control(entry, { subtype: "interrupt" });
      entry.activity?.(t("activity.interruptedAnswering"));
      return { ok: true, mode: "interrupt" };
    } catch (error) {
      if (entry.turn) entry.turn.answering = false;
      return { ok: false, error: error.message };
    }
  }
  // Claude Code control command over stdin (stream-json), with the answer matched by request_id.
  function control(entry, request, timeout = 5000) {
    if (!entry.child.stdin?.writable) return Promise.reject(new Error(t("errors.cliNoInput")));
    const id = `beagledock-${++entry.controlSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.controls.delete(id);
        reject(new Error(t("errors.cliNoCommandAnswer")));
      }, timeout);
      timer.unref?.();
      entry.controls.set(id, {
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
      entry.child.stdin.write(JSON.stringify({ type: "control_request", request_id: id, request }) + "\n");
    });
  }
  // Changing the permission level with the conversation open (even in the middle of a reply).
  // `applied: "now"` = the running CLI already uses the new level; `"next"` = applies from the next
  // message (the CLI restarts with the new policy and resumes the same conversation).
  // Switching to "Full access" also releases the approvals that were waiting in this conversation.
  async function setPermission(payload) {
    const { sessionId, permission } = payload || {};
    if (typeof sessionId !== "string" || !PERMISSIONS.has(permission))
      return { ok: false, error: t("errors.invalidPermissionChange") };
    const entry = processes.get(sessionId);
    let applied = "next";
    if (entry && entry.child.exitCode === null && !entry.child.killed) {
      const readonly = (level) => level === "plan" || level === "ask";
      if (entry.providerId === "claude") {
        // "CLI global" has no equivalent mode to send: it goes back to it by restarting on the next message.
        if (permission !== "inherit" && entry.effort !== "plan") {
          const mode = readonly(permission) ? "plan" : permission === "full" ? "bypassPermissions" : "acceptEdits";
          try {
            await control(entry, { subtype: "set_permission_mode", mode });
            if (processes.get(sessionId) === entry) {
              entry.permission = permission;
              entry.key = entry.keyFor(permission, undefined);
              entry.selection = JSON.stringify([entry.model, entry.effort, permission]);
              applied = "now";
            }
          } catch {
            // Without the live switch, the old key makes the next message restart with the new level.
          }
        }
      } else if (entry.providerId === "antigravity" && entry.approvalBridge) {
        // The approval bridge decides each tool on the spot; what AGY fixes at startup (plan
        // mode, deny rules, sandbox) only changes when it restarts on the next message.
        entry.approvalBridge.setPermission(permission);
        if (entry.permission === "edits" && permission !== "inherit") applied = "now";
      }
    }
    const approved = permission === "full" ? approvals?.approveSession?.(sessionId) || 0 : 0;
    return { ok: true, applied, approved };
  }
  return {
    execute,
    inject,
    answerNow,
    kill,
    setPermission,
    isBusy: (id) => (id === undefined ? busy.size > 0 : busy.has(id)),
    busyCount: () => busy.size,
    // Native compaction: only Codex has its own command outside the conversation; in Claude Code and AGY
    // (1.4.12, verified) it's the /compact message, sent by the app as a normal turn.
    compact: (id, providerId) =>
      providerId === "codex"
        ? codex.compact(id)
        : Promise.resolve({
            ok: false,
            error: t("errors.compactIsMessage"),
          }),
    async prepareUpdate() {
      await codex.prepareUpdate();
      if (busy.size)
        throw new Error(t("errors.waitRepliesBeforeUpdate"));
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
                    new Error(t("errors.cliStillClosing")),
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
module.exports = { planExit, createCliRunner, buildArgs };
