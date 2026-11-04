import type { ChatMessage } from "../types";

import { t, tn } from "../i18n";
/**
 * Work that goes on after the reply finished: background commands and agents still running. The
 * CLI reports when they end on its own (and may reply again), so the conversation isn't idle even
 * without a reply in progress.
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
  if (commands && agents)
    return t("background.commandsAndAgents", {
      commands: tn("background.commands", commands),
      agents: tn("background.agents", agents),
    });
  return commands ? tn("background.onlyCommands", commands) : tn("background.onlyAgents", agents);
}

/**
 * A reply is being produced right now, including turns the CLI started on its own (the main agent
 * answering after a background agent finished). Those never go through `sendPrompt`, so the
 * session status alone would show the conversation as idle while the AI is still working.
 * Queued replies don't count: they wait behind the reply that is actually running.
 */
export function hasLiveReply(messages: ChatMessage[] | undefined) {
  return !!messages?.some((m) => m.isStreaming && !m.queuedFor);
}
