// Offline protocol fixture: never calls a provider or reads user credentials.
const fs = require("fs"),
  path = require("path"),
  { randomUUID } = require("crypto");
const args = process.argv.slice(2),
  name = path.basename(process.argv[1]);
if (args[0] === "update") {
  fs.writeFileSync(
    path.join(process.env.BEAGLEDOCK_SMOKE_ROOT, "update-" + name + ".json"),
    JSON.stringify(args),
  );
  console.log("Updated fixture.");
  process.exit(0);
}
// Terminal mode: without the structured protocol's arguments, the CLI opens its own interface.
// The fixture imitates only the essentials: announces the arguments and records what came from the keyboard.
const structured = ["-p", "--print", "exec", "app-server", "--input-format", "--output-format", "models", "mcp"];
if (process.stdin.isTTY && !args.some((a) => structured.includes(a) || a.startsWith("/"))) {
  const root = process.env.BEAGLEDOCK_SMOKE_ROOT;
  fs.writeFileSync(path.join(root, "tui-" + name + ".json"), JSON.stringify({ args, cwd: process.cwd() }));
  // Like the real CLIs, turns on bracketed paste (the terminal marks the start and end of the block).
  process.stdout.write(`\x1b[?2004hFIXTURE TUI ${name} ${args.join(" ")}\r\n> `);
  process.stdin.setRawMode(true);
  let pending = "";
  process.stdin.on("data", (chunk) => {
    const text = chunk.toString();
    fs.appendFileSync(path.join(root, "tui-input-" + name + ".txt"), text);
    process.stdout.write(text.includes("\r") ? "\r\nENVIADO\r\n> " : text.replace(/\x1b\[20[01]~/g, ""));
    pending += text.split("\r")[0];
    if (!text.includes("\r")) return;
    const prompt = pending.replace(/\x1b\[20[01]~/g, "").trim();
    pending = "";
    // AGY: like the real CLI, animates the screen while it works, saves the conversation in brain/<id> and goes
    // silent when done (that's how BeagleDock notices the end and reads the history).
    const conversation = args[0] === "--conversation" ? args[1] : null;
    if (name !== "agy" || !prompt || !conversation) return;
    const started = Date.now();
    const timer = setInterval(() => {
      process.stdout.write("\r⠋ trabalhando " + (Date.now() - started));
      if (Date.now() - started < 3200) return;
      clearInterval(timer);
      const dir = path.join(process.env.HOME, ".gemini/antigravity-cli/brain", conversation, ".system_generated/logs");
      fs.mkdirSync(dir, { recursive: true });
      const at = new Date().toISOString();
      fs.appendFileSync(
        path.join(dir, "transcript.jsonl"),
        [
          { type: "USER_INPUT", created_at: at, content: `<USER_REQUEST>\n${prompt}\n</USER_REQUEST>` },
          { type: "PLANNER_RESPONSE", created_at: at, content: "FIXTURE TUI RESPOSTA" },
        ].map((e) => JSON.stringify(e) + "\n").join(""),
      );
      process.stdout.write("\r\nFIXTURE TUI RESPOSTA\r\n> ");
    }, 200);
  });
  return;
}
if (args.includes("--version")) {
  console.log("fixture 1.4.0");
  process.exit(0);
}
if (args[0] === "models") {
  console.log(
    "fixture-orbit-economy\tFixture Orbit (Economy)\nfixture-orbit-standard\tFixture Orbit (Standard)\nfixture-orbit-research\tFixture Orbit (Research)\nfixture-solo-agile\tFixture Solo (Agile)",
  );
  process.exit(0);
}
if (name === "agy" && args.includes("/usage")) {
  console.log(
    JSON.stringify({
      status: "SUCCESS",
      num_turns: 0,
      command: {
        name: "usage",
        data: {
          groups: [
            {
              name: "Gemini Models",
              buckets: [
                { id: "gemini-5h", window: "5h", remaining_fraction: 0.8 },
                {
                  id: "gemini-weekly",
                  window: "weekly",
                  remaining_fraction: 0.6,
                },
              ],
            },
            {
              name: "Claude and GPT models",
              buckets: [
                { id: "3p-5h", window: "5h", remaining_fraction: 0.7 },
                { id: "3p-weekly", window: "weekly", remaining_fraction: 0.5 },
              ],
            },
          ],
        },
      },
    }),
  );
  process.exit(0);
}
if (name === "claude" && args.includes("/usage")) {
  const at = (hours) =>
    new Date(Date.now() + hours * 3600000).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/Sao_Paulo",
    });
  console.log(
    JSON.stringify({
      is_error: false,
      subtype: "success",
      result: `Current session: 34% used · resets ${at(2)} (America/Sao_Paulo)\nCurrent week (all models): 12% used · resets ${at(72)} (America/Sao_Paulo)`,
    }),
  );
  process.exit(0);
}
const fixtureQuestions = [
  { id: "channels", header: "Channel", question: "Which campaign channels?", multiSelect: true, is_multi_select: true,
    options: [{ label: "Email", description: "Use the existing channel" }, { label: "WhatsApp", description: "Use approved templates" }] },
  { id: "details", header: "Details", question: "Which details should we include?", options: [{ label: "Default" }, { label: "All details" }] },
];
const root = process.env.BEAGLEDOCK_SMOKE_ROOT;
if (!root) throw new Error("Fixture requires isolated storage.");
if (name === "codex" && args[0] === "app-server") {
  let thread,
    buffer = "",
    turns = 0,
    approvalFinish,
    questionFinish;
  const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      if (m.id === "codex-question" && questionFinish) {
        questionFinish(m.result.answers);
        questionFinish = null;
        continue;
      }
      if (m.id === "codex-approval" && approvalFinish) {
        approvalFinish(m.result?.decision === "accept");
        approvalFinish = null;
        continue;
      }
      if (m.method === "account/rateLimits/read") {
        const at = (hours) => Math.floor(Date.now() / 1000) + hours * 3600;
        emit({
          id: m.id,
          result: {
            rateLimits: {
              limitId: "codex",
              planType: "plus",
              primary: { usedPercent: 21, windowDurationMins: 300, resetsAt: at(3) },
              secondary: { usedPercent: 47, windowDurationMins: 10080, resetsAt: at(80) },
            },
          },
        });
        continue;
      }
      if (m.method === "initialize") emit({ id: m.id, result: {} });
      else if (m.method === "thread/start" || m.method === "thread/resume") {
        thread = m.params.threadId || randomUUID();
        const file = path.join(root, thread + ".json");
        if (m.method === "thread/resume" && !fs.existsSync(file)) {
          emit({ id: m.id, error: { message: "Unknown fixture session" } });
          continue;
        }
        if (!fs.existsSync(file))
          fs.writeFileSync(file, JSON.stringify({ count: 0 }));
        emit({ id: m.id, result: { thread: { id: thread } } });
      } else if (m.method === "turn/start") {
        fs.appendFileSync(
          path.join(root, "received-codex-input.jsonl"),
          JSON.stringify((m.params.input || []).map((i) => i.type + (i.name ? ":" + i.name : ""))) + "\n",
        );
        const file = path.join(root, thread + ".json"),
          count = JSON.parse(fs.readFileSync(file)).count + 1;
        fs.writeFileSync(file, JSON.stringify({ count }));
        const turnId = "turn-" + ++turns,
          itemId = "message-" + turns;
        emit({ id: m.id, result: { turn: { id: turnId } } });
        emit({
          method: "turn/started",
          params: { threadId: thread, turn: { id: turnId } },
        });
        fs.appendFileSync(
          path.join(root, "received-codex.jsonl"),
          JSON.stringify({ id: thread, text: m.params.input?.[0]?.text }) +
            "\n",
        );
        if (m.params.input?.[0]?.text?.startsWith("smoke-hang")) {
          emit({
            method: "item/agentMessage/delta",
            params: {
              threadId: thread,
              turnId,
              itemId,
              delta: "PARTIAL_BEFORE_STOP",
            },
          });
          continue;
        }
        if (m.params.input?.[0]?.text === "smoke-question") {
          questionFinish = (answers) => {
            emit({ method: "item/completed", params: { threadId: thread, turnId, item: {
              id: itemId, type: "agentMessage", text: "QUESTION_ANSWER_DONE " + JSON.stringify(answers),
            } } });
            emit({ method: "turn/completed", params: { threadId: thread, turn: { id: turnId, status: "completed" } } });
          };
          emit({ id: "codex-question", method: "item/tool/requestUserInput", params: { threadId: thread, questions: fixtureQuestions } });
          continue;
        }
        const promptText = m.params.input?.[0]?.text || "";
        const text = promptText === "smoke-plan" ? "PLAN_READY_FOR_REVIEW"
          : promptText.startsWith("Plan approved.") ? "PLAN_RESTORED_AND_CONTINUED" : `codex fixture resposta ${count}`;
        if (m.params.input?.[0]?.text?.startsWith("smoke-approval")) {
          const childApproval = m.params.input[0].text.includes("-child");
          const approvalThread = childApproval ? `child-${thread}` : thread;
          if (childApproval) emit({ method: "item/started", params: { threadId: thread, turnId, item: { id: "spawn", type: "collabAgentToolCall", tool: "spawnAgent", receiverThreadIds: [approvalThread] } } });
          approvalFinish = (allow) => {
            const finish = () => {
            const answer = allow
              ? "APPROVED_ACTION_DONE"
              : "DENIED_ACTION_DONE";
            emit({
              method: "item/completed",
              params: {
                threadId: thread,
                turnId,
                item: { id: itemId, type: "agentMessage", text: answer },
              },
            });
            emit({
              method: "turn/completed",
              params: {
                threadId: thread,
                turn: { id: turnId, status: "completed" },
              },
            });
            };
            if (childApproval && allow) {
              emit({ method: "item/started", params: { threadId: approvalThread, item: { id: "child-cmd", type: "commandExecution", command: "fixture child tests" } } });
              emit({ method: "item/commandExecution/outputDelta", params: { threadId: approvalThread, itemId: "child-cmd", delta: "CHILD_FIRST\n" } });
              setTimeout(() => {
                emit({ method: "item/completed", params: { threadId: approvalThread, item: { id: "child-cmd", type: "commandExecution", status: "completed", aggregatedOutput: "CHILD_FIRST\nCHILD_LAST\n" } } });
                emit({ method: "item/completed", params: { threadId: thread, turnId, item: { id: "child-done", type: "subAgentActivity", agentThreadId: approvalThread, kind: "completed" } } });
                finish();
              }, 650);
            } else finish();
          };
          emit({
            id: "codex-approval",
            method: "item/commandExecution/requestApproval",
            params: {
              threadId: approvalThread,
              turnId,
              itemId: "cmd",
              command: "fixture approval only",
            },
          });
          continue;
        }

        if (m.params.input?.[0]?.text?.startsWith("smoke-live")) {
          setTimeout(() => {
            emit({ method: "item/started", params: { threadId: thread, turnId, item: { id: "live-reason", type: "reasoning" } } });
            emit({ method: "item/reasoning/summaryTextDelta", params: { threadId: thread, turnId, itemId: "live-reason", delta: "Analisando um comando com argumentos extensos e acompanhando o agente. ".repeat(12) } });
          }, 250);
          setTimeout(() => emit({ method: "item/completed", params: { threadId: thread, turnId, item: { id: "live-reason", type: "reasoning", summary: ["Análise concluída."] } } }), 850);
          emit({
            method: "item/started",
            params: {
              threadId: thread,
              turnId,
              item: {
                id: "live-cmd",
                type: "commandExecution",
                command: "fixture tests",
              },
            },
          });
          emit({
            method: "item/commandExecution/outputDelta",
            params: {
              threadId: thread,
              turnId,
              itemId: "live-cmd",
              delta: "LIVE_FIRST while running\n",
            },
          });
          // Second command in parallel: each one must get its own shell tab.
          emit({ method: "item/started", params: { threadId: thread, turnId, item: { id: "live-cmd-2", type: "commandExecution", command: "fixture build" } } });
          emit({ method: "item/commandExecution/outputDelta", params: { threadId: thread, turnId, itemId: "live-cmd-2", delta: "PARALLEL_BUILD while running\n" } });
          emit({
            method: "item/agentMessage/delta",
            params: {
              threadId: thread,
              turnId,
              itemId,
              delta: "LIVE_CHAT_PARTIAL",
            },
          });
          setTimeout(
            () =>
              emit({
                method: "item/commandExecution/outputDelta",
                params: {
                  threadId: thread,
                  turnId,
                  itemId: "live-cmd",
                  delta: "LIVE_MIDDLE while running\n",
                },
              }),
            400,
          );
          setTimeout(() => {
            emit({
              method: "item/completed",
              params: {
                threadId: thread,
                turnId,
                item: { id: itemId, type: "agentMessage", text },
              },
            });
            emit({
              method: "turn/completed",
              params: {
                threadId: thread,
                turn: { id: turnId, status: "completed" },
              },
            });
          }, 1600);
          continue;
        }

        emit({
          method: "item/agentMessage/delta",
          params: { threadId: thread, turnId, itemId, delta: text },
        });
        emit({
          method: "item/completed",
          params: {
            threadId: thread,
            turnId,
            item: { id: itemId, type: "agentMessage", text },
          },
        });
        emit({
          method: "turn/completed",
          params: {
            threadId: thread,
            turn: { id: turnId, status: "completed" },
          },
        });
      }
    }
  });
  process.stdin.on("end", () => process.exit(0));
  return;
}
let id;
if (name === "codex" && args.includes("resume")) id = args.at(-2);
if (name === "claude" && args.includes("--resume"))
  id = args[args.indexOf("--resume") + 1];
if (name === "agy" && args.includes("--conversation"))
  id = args[args.indexOf("--conversation") + 1];
if (id && !fs.existsSync(path.join(root, id + ".json"))) {
  console.error("Unknown fixture session");
  process.exit(1);
}
id ||= randomUUID();
fs.writeFileSync(
  path.join(root, `last-args-${name}.json`),
  JSON.stringify(args),
);
let responsePrompt = "";
function respond() {
  const file = path.join(root, id + ".json");
  const count =
    (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)).count : 0) + 1;
  fs.writeFileSync(file, JSON.stringify({ count }));
  const emit = (ev) => process.stdout.write(JSON.stringify(ev) + "\n");
  const text =
    `${name} fixture resposta ${count}` +
    (responsePrompt.startsWith("smoke-scroll")
      ? "\n" +
        Array(150)
          .fill("Fixture streaming content for chat scrolling.")
          .join("\n")
      : "");
  if (responsePrompt.startsWith("smoke-live") && name !== "codex") {
    const project = process.cwd().replace(/[^a-zA-Z0-9]/g, "-");
    const dir =
      name === "agy"
        ? path.join(
            process.env.HOME,
            ".gemini",
            "antigravity-cli",
            "brain",
            id,
            ".system_generated",
            "tasks",
          )
        : path.join(
            require("os").tmpdir(),
            `claude-${process.getuid?.() ?? process.env.USERNAME}`,
            project,
            id,
            "tasks",
          );
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(
      dir,
      name === "agy" ? "task-2.log" : "fixture.output",
    );
    if (name === "agy") emit({ event: "init", conversation_id: id });
    else emit({ type: "system", session_id: id });
    if (name === "agy")
      emit({
        event: "step_update",
        step_update: {
          step_index: 2,
          step_type: "tool",
          state: "ACTIVE",
          tool_info: { parameters: { CommandLine: "fixture tests" } },
        },
      });
    else
      emit({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "live-tool",
              name: "Bash",
              input: { command: "fixture tests" },
            },
          ],
        },
      });
    fs.writeFileSync(file, "LIVE_FIRST while running\n");
    const partial = () =>
      name === "agy"
        ? emit({
            event: "step_update",
            step_update: {
              step_type: "agent_response",
              text_delta: "LIVE_CHAT_PARTIAL",
            },
          })
        : emit({
            type: "stream_event",
            event: { delta: { type: "text_delta", text: "LIVE_CHAT_PARTIAL" } },
          });
    setTimeout(partial, 150);
    setTimeout(
      () => fs.appendFileSync(file, "LIVE_MIDDLE while running\n"),
      400,
    );
    setTimeout(() => {
      fs.appendFileSync(file, "LIVE_LAST done\n");
      if (name === "agy")
        emit({
          event: "result",
          result: { status: "SUCCESS", response: text },
        });
      else {
        emit({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "live-tool",
                content:
                  "LIVE_FIRST while running\nLIVE_MIDDLE while running\nLIVE_LAST done\n",
              },
            ],
          },
        });
        fs.unlinkSync(file);
        emit({ type: "result", result: text });
      }
    }, 1600);
    return;
  }
  if (name === "codex") {
    emit({ type: "thread.started", thread_id: id });
    emit({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: text,
      },
    });
    emit({ type: "turn.completed" });
  } else if (name === "agy") {
    emit({ event: "init", conversation_id: id, init: {} });
    emit({
      event: "step_update",
      step_update: {
        conversation_id: id,
        step_index: count,
        state: "DONE",
        step_type: "agent_response",
        text_delta: text,
      },
    });
    emit({
      event: "result",
      result: {
        conversation_id: id,
        status: "SUCCESS",
        response: text,
      },
    });
  } else {
    emit({ type: "system", session_id: id });
    emit({ type: "result", result: text });
  }
}
let approvalPending = false;
// Hung run (smoke-hang): like the real CLI in the middle of a long step, it receives the messages
// delivered during the reply, but doesn't answer; only Stop ends it.
let hanging = false;
let answerHold = false;
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  if (name === "codex") return;
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines)
    if (line.trim()) {
      const input = JSON.parse(line);
      // Live permission mode switch (Claude Code 2.1.316 protocol): confirms and records.
      if (name === "claude" && input.type === "control_request" && input.request?.subtype === "set_permission_mode") {
        fs.appendFileSync(path.join(root, "permission-modes-claude.jsonl"), JSON.stringify(input.request.mode) + "\n");
        process.stdout.write(
          JSON.stringify({
            type: "control_response",
            response: { subtype: "success", request_id: input.request_id, response: { mode: input.request.mode } },
          }) + "\n",
        );
        continue;
      }
      // "Answer now" (Claude Code 2.1.317 protocol): the long command goes to the background
      // or the step is interrupted, and the message delivered during it is answered right after.
      if (
        name === "claude" &&
        answerHold &&
        input.type === "control_request" &&
        ["background_tasks", "interrupt"].includes(input.request?.subtype)
      ) {
        const sub = input.request.subtype;
        const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
        fs.appendFileSync(path.join(root, "answer-now-claude.jsonl"), JSON.stringify(input.request) + "\n");
        out({
          type: "control_response",
          response: { subtype: "success", request_id: input.request_id, response: sub === "interrupt" ? { still_queued: [] } : { backgrounded: true } },
        });
        if (sub === "background_tasks") {
          out({ type: "system", subtype: "task_updated", task_id: "fixture-task", patch: { is_backgrounded: true } });
          out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "fixture-long", content: "backgrounded" }] } });
        } else {
          out({ type: "system", subtype: "task_notification", task_id: "fixture-task", tool_use_id: "fixture-long", status: "stopped" });
          out({ type: "result", is_error: true, subtype: "error_during_execution" });
        }
        out({ type: "assistant", message: { model: "fixture", content: [{ type: "text", text: "RESPOSTA_AGORA" }] } });
        out({ type: "result", is_error: false, result: "RESPOSTA_AGORA" });
        answerHold = false;
        if (sub === "background_tasks")
          setTimeout(
            () => out({ type: "system", subtype: "task_notification", task_id: "fixture-task", tool_use_id: "fixture-long", status: "completed", summary: "fim" }),
            1500,
          );
        continue;
      }
      if (input.type === "control_response" && input.response?.request_id === "claude-question") {
        process.stdout.write(JSON.stringify({ type: "result", result: "QUESTION_ANSWER_DONE " + JSON.stringify(input.response.response.updatedInput.answers) }) + "\n");
        continue;
      }
      if (input.type === "control_response" && approvalPending) {
        approvalPending = false;
        const answer =
          input.response?.response?.behavior === "allow"
            ? "APPROVED_ACTION_DONE"
            : "DENIED_ACTION_DONE";
        process.stdout.write(
          JSON.stringify({ type: "result", result: answer }) + "\n",
        );
        continue;
      }
      const content = input.message?.content;
      // Claude sends blocks (image + text) when there are attachments; Antigravity sends text.
      responsePrompt =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.filter((b) => b.type === "text").map((b) => b.text).join("\n")
            : "";
      fs.appendFileSync(
        path.join(root, "received-" + name + ".jsonl"),
        JSON.stringify({
          id,
          text: responsePrompt,
          ...(Array.isArray(content)
            ? { blocks: content.map((b) => b.type + (b.source ? ":" + b.source.media_type : "")) }
            : {}),
        }) + "\n",
      );
      if (hanging || answerHold) continue;
      if (name === "claude" && responsePrompt.startsWith("smoke-answer-now")) {
        answerHold = true;
        const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
        out({ type: "system", session_id: id });
        out({ type: "assistant", message: { model: "fixture", content: [{ type: "tool_use", id: "fixture-long", name: "Bash", input: { command: "sleep 600" } }] } });
        out({ type: "system", subtype: "task_started", task_id: "fixture-task", tool_use_id: "fixture-long", task_type: "local_bash", is_backgrounded: false });
        continue;
      }
      if (responsePrompt.startsWith("smoke-hang")) {
        hanging = true;
        if (name === "agy") {
          process.stdout.write(
            JSON.stringify({ event: "init", conversation_id: id }) + "\n",
          );
          process.stdout.write(
            JSON.stringify({
              event: "step_update",
              step_update: {
                step_type: "agent_response",
                text_delta: "PARTIAL_BEFORE_STOP",
              },
            }) + "\n",
          );
        } else {
          process.stdout.write(
            JSON.stringify({ type: "system", session_id: id }) + "\n",
          );
          process.stdout.write(
            JSON.stringify({
              type: "stream_event",
              event: {
                delta: { type: "text_delta", text: "PARTIAL_BEFORE_STOP" },
              },
            }) + "\n",
          );
        }
        continue;
      }
      if (name === "agy" && input.event !== "user")
        throw new Error("Invalid AGY input envelope");
      if (name === "claude" && input.type !== "user")
        throw new Error("Invalid Claude input envelope");
      if (responsePrompt === "smoke-plan" || responsePrompt.startsWith("Plan approved.")) {
        const answer = responsePrompt === "smoke-plan" ? "PLAN_READY_FOR_REVIEW" : "PLAN_RESTORED_AND_CONTINUED";
        const result = name === "agy"
          ? { event: "result", conversation_id: id, result: { status: "SUCCESS", response: answer } }
          : { type: "result", session_id: id, result: answer };
        process.stdout.write(JSON.stringify(result) + "\n");
        continue;
      }
      if (responsePrompt === "smoke-question") {
        if (name === "claude") {
          process.stdout.write(JSON.stringify({ type: "control_request", request_id: "claude-question", request: {
            subtype: "can_use_tool", tool_name: "AskUserQuestion", input: { questions: fixtureQuestions },
          } }) + "\n");
        } else {
          process.stdout.write(JSON.stringify({ event: "init", conversation_id: id }) + "\n");
          const client = require("net").createConnection(process.env.BEAGLEDOCK_APPROVAL_SOCKET);
          let response = "";
          client.on("connect", () => client.write(JSON.stringify({ token: process.env.BEAGLEDOCK_APPROVAL_TOKEN, request: {
            conversationId: id, toolCall: { name: "ask_question", args: { questions: fixtureQuestions.map((q) => ({
              question: q.question, options: q.options.map((o) => o.label), is_multi_select: q.is_multi_select,
            })) } },
          } }) + "\n"));
          client.on("data", (chunk) => response += chunk);
          client.on("close", () => process.stdout.write(JSON.stringify({ event: "result", result: {
            status: "SUCCESS", response: "QUESTION_ANSWER_DONE " + JSON.parse(response).reason,
          } }) + "\n"));
        }
        continue;
      }
      if (responsePrompt.startsWith("smoke-approval")) {
        if (name === "claude") {
          process.stdout.write(
            JSON.stringify({ type: "system", session_id: id }) + "\n",
          );
          approvalPending = true;
          process.stdout.write(
            JSON.stringify({
              type: "control_request",
              request_id: "claude-approval",
              request: {
                subtype: "can_use_tool",
                tool_name: "Bash",
                input: { command: "fixture approval only" },
              },
            }) + "\n",
          );
        } else if (name === "agy") {
          process.stdout.write(
            JSON.stringify({ event: "init", conversation_id: id }) + "\n",
          );
          setTimeout(() => {
            const client = require("net").createConnection(
              process.env.BEAGLEDOCK_APPROVAL_SOCKET,
            );
            let result = "";
            client.on("connect", () =>
              client.write(
                JSON.stringify({
                  token: process.env.BEAGLEDOCK_APPROVAL_TOKEN,
                  request: {
                    conversationId: responsePrompt.includes("-child") ? `child-${id}` : id,
                    toolCall: {
                      name: "run_command",
                      args: { CommandLine: "fixture approval only" },
                    },
                  },
                }) + "\n",
              ),
            );
            client.on("data", (c) => (result += c));
            client.on("close", () => {
              const allow = JSON.parse(result).decision === "auto_approve";
              const finish = () => {
              process.stdout.write(
                JSON.stringify({
                  event: "result",
                  result: {
                    status: "SUCCESS",
                    response: allow
                      ? "APPROVED_ACTION_DONE"
                      : "DENIED_ACTION_DONE",
                  },
                }) + "\n",
              );
              };
              if (responsePrompt.includes("-child") && allow) {
                const base = path.join(process.env.GEMINI_CLI_HOME || path.join(require("os").homedir(), ".gemini"), "antigravity-cli", "brain", `child-${id}`, ".system_generated");
                fs.mkdirSync(path.join(base, "tasks"), { recursive: true });
                fs.mkdirSync(path.join(base, "logs"), { recursive: true });
                fs.writeFileSync(path.join(base, "logs", "transcript.jsonl"), JSON.stringify({ step_index: 2, type: "PLANNER_RESPONSE", tool_calls: [{ name: "run_command", args: { CommandLine: JSON.stringify("fixture child tests") } }] }) + "\n");
                const log = path.join(base, "tasks", "task-3.log");
                fs.writeFileSync(log, "CHILD_FIRST\n");
                setTimeout(() => { fs.appendFileSync(log, "CHILD_LAST\n"); finish(); }, 650);
              } else finish();
            });
          }, 50);
        }
        continue;
      }
      if (responsePrompt.startsWith("smoke-concurrent"))
        setTimeout(respond, 2500);
      else if (responsePrompt.startsWith("smoke-queue"))
        setTimeout(respond, 800);
      else respond();
    }
});
process.stdin.on("end", () => {
  if (name === "codex") respond();
});
