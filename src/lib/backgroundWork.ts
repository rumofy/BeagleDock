import type { ChatMessage } from "../types";

/**
 * Trabalho que continua depois de a resposta terminar: comandos e agentes em segundo plano ainda
 * rodando. A CLI avisa o fim deles sozinha (e pode responder de novo), então a conversa não está
 * parada, mesmo sem resposta em andamento.
 */
export function backgroundWork(messages: ChatMessage[] | undefined) {
  let commands = 0;
  let agents = 0;
  for (const message of messages || []) {
    if (message.isStreaming) continue;
    for (const event of message.events || []) {
      if (event.status !== "running") continue;
      if (event.kind === "command" && event.meta?.background === true) commands++;
      else if (event.kind === "agent") agents++;
    }
  }
  return { commands, agents, total: commands + agents };
}

export function backgroundLabel({ commands, agents }: { commands: number; agents: number }) {
  const parts = [
    commands ? `${commands} ${commands === 1 ? "comando" : "comandos"}` : "",
    agents ? `${agents} ${agents === 1 ? "agente" : "agentes"}` : "",
  ].filter(Boolean);
  return `${parts.join(" e ")} em segundo plano`;
}
