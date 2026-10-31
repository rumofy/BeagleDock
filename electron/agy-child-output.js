// O AGY não encaminha ferramentas de subagentes para o stream-json do pai.
// O transcript nativo fornece o comando e seu resultado; tasks/*.log fornece a saída ao vivo.
function createAgyChildOutput({
  onCommand = () => {},
  onOutput = () => {},
  onToolStart = () => {},
  onToolEnd = () => {},
  onFinish = () => {},
  hasLiveOutput = () => false,
}) {
  let buffer = "";
  const calls = new Set(), pending = [], results = new Map(), finishedSteps = new Set();
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    if (buffer.length > 1024 * 1024) buffer = "";
    for (const line of lines) {
      let step;
      try { step = JSON.parse(line); } catch { continue; }
      if (!Number.isInteger(step.step_index)) continue;
      if (step.type === "PLANNER_RESPONSE" && Array.isArray(step.tool_calls) && step.tool_calls.length) {
        for (const [index, tool] of step.tool_calls.entries()) {
          const key = `${step.step_index}:${index}`;
          if (calls.has(key)) continue;
          calls.add(key);
          let command = tool.args?.CommandLine;
          try { command = JSON.parse(command); } catch {}
          pending.push({ id: key, name: tool.name, command });
          onToolStart({ id: key, name: tool.name, command, args: tool.args });
          if (tool.name === "run_command" && typeof command === "string") {
            onCommand(command);
          }
        }
      } else if (step.type === "PLANNER_RESPONSE" && step.status === "DONE" && !step.tool_calls?.length) {
        if (!finishedSteps.has(step.step_index)) {
          finishedSteps.add(step.step_index);
          onFinish(step.content);
        }
      } else if (step.type === "GENERIC") {
        let result = results.get(step.step_index);
        if (!result) {
          const item = pending.shift() || {};
          result = { id: item.id, tool: item.name, text: "", done: false };
          results.set(step.step_index, result);
        }
        if (!result.done && step.status !== "RUNNING") {
          result.done = true;
          if (result.id)
            onToolEnd({
              id: result.id,
              name: result.tool,
              status: step.status === "ERROR" ? "error" : "done",
              error: step.error,
            });
        }
        if (!["run_command", "manage_task"].includes(result.tool) || typeof step.content !== "string") continue;
        // Não publica mensagens do agente, prompts nem outras ferramentas como saída de terminal.
        const marker = "Command output:\n";
        const at = step.content.indexOf(marker);
        if (at < 0 || hasLiveOutput(step.step_index)) continue;
        const text = step.content.slice(at + marker.length);
        if (text.startsWith(result.text) && text.length > result.text.length)
          onOutput(text.slice(result.text.length));
        result.text = text;
      }
    }
  };
}
module.exports = { createAgyChildOutput };
