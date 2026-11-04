import type { ChatEvent, ChatMessage } from "../types";

export interface StreamChunkPayload {
  sessionId: string;
  responseMessageId?: string;
  fullText?: string;
  activity?: string;
  detail?: string;
  emittedAt?: number;
}
export interface StreamEventPayload {
  sessionId: string;
  responseMessageId?: string;
  event: ChatEvent;
  emittedAt?: number;
}
export type StreamItem =
  | { kind: "chunk"; payload: StreamChunkPayload; receivedAt: number }
  | { kind: "event"; payload: StreamEventPayload; receivedAt: number };

const ANSI = /\x1B\[[0-9;]*[a-zA-Z]/g;
const clean = (text: string) =>
  text.includes("\x1B") ? text.replace(ANSI, "") : text;

function sameEvent(a: ChatEvent, b: ChatEvent) {
  return (
    a.status === b.status &&
    a.detail === b.detail &&
    a.text === b.text &&
    a.title === b.title &&
    a.durationMs === b.durationMs
  );
}

function applyOne(
  message: ChatMessage,
  item: StreamItem,
  now: number,
  skipText = false,
): ChatMessage {
  const since = message.startedAt ?? now;
  if (item.kind === "event") {
    const events = message.events ? [...message.events] : [];
    const index = events.findIndex((e) => e.id === item.payload.event.id);
    const changed = index < 0 || !sameEvent(events[index], item.payload.event);
    if (index >= 0) events[index] = item.payload.event;
    else events.push(item.payload.event);
    return {
      ...message,
      queuedFor: undefined,
      // A new step in this reply: the AI has read the delivered message.
      deliveredFor: undefined,
      events,
      lastEventAt: now,
      lastProgressAt: changed ? now : (message.lastProgressAt ?? since),
    };
  }
  const { fullText, activity, detail } = item.payload;
  // `fullText` is the whole text: within a batch only the last one per message needs processing.
  // The earlier ones still count as progress, without cleaning or comparing the text again.
  const text =
    typeof fullText === "string" && !skipText ? clean(fullText) : message.text;
  const textArrived = typeof fullText === "string" && skipText;
  const activityChanged =
    activity !== undefined &&
    (activity !== message.activity || detail !== message.detail);
  return {
    ...message,
    // Something arrived from the CLI for this reply: it has left the queue.
    queuedFor: undefined,
    // Only text proves the AI read the delivered message (the activity notice arrives earlier).
    deliveredFor:
      message.deliveredFor && typeof fullText === "string" && /\S/.test(fullText)
        ? undefined
        : message.deliveredFor,
    text,
    activity: activity ?? message.activity,
    detail: activity !== undefined ? detail : message.detail,
    activitySince:
      activity !== undefined && activity !== message.activity
        ? now
        : (message.activitySince ?? since),
    lastEventAt: now,
    lastProgressAt:
      textArrived || text !== message.text || activityChanged
        ? now
        : (message.lastProgressAt ?? since),
  };
}

/** Applies a batch of stream events to the messages, copying each list at most once. */
export function applyStreamItems(
  prev: Record<string, ChatMessage[]>,
  items: StreamItem[],
  now: number = Date.now(),
): Record<string, ChatMessage[]> {
  let next = prev;
  const copied = new Set<string>();
  const lastText = new Map<string, number>();
  items.forEach((item, index) => {
    if (item.kind === "chunk" && typeof item.payload.fullText === "string")
      lastText.set(
        `${item.payload.sessionId}|${item.payload.responseMessageId ?? ""}`,
        index,
      );
  });
  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    const sessionId = item.payload.sessionId;
    const list = next[sessionId];
    if (!list) continue;
    const responseId = item.payload.responseMessageId;
    // Without a reply id it only applies when exactly one message is streaming; with the queue, a late
    // event from another turn would land on the wrong reply.
    const streaming = responseId ? [] : list.filter((m) => m.isStreaming);
    if (!responseId && streaming.length !== 1) continue;
    const index = responseId
      ? list.findIndex((m) => m.id === responseId)
      : list.indexOf(streaming[0]);
    if (index < 0) continue;
    // A finished reply still receives updates from background agents: only for steps it already
    // has (or their children), never text or activity.
    if (!list[index].isStreaming) {
      const late = item.kind === "event" ? item.payload.event : null;
      const known =
        late &&
        list[index].events?.some(
          (e) => e.id === late.id || e.id === late.parentId,
        );
      // A late event never reopens a finished step.
      const existing =
        late && list[index].events?.find((e) => e.id === late.id);
      const reopens =
        !!existing &&
        existing.status !== "running" &&
        late.status === "running";
      if (!known || reopens) continue;
    }
    if (!copied.has(sessionId)) {
      next = { ...next, [sessionId]: [...list] };
      copied.add(sessionId);
    }
    const skipText =
      item.kind === "chunk" &&
      typeof item.payload.fullText === "string" &&
      lastText.get(`${sessionId}|${item.payload.responseMessageId ?? ""}`) !==
        itemIndex;
    next[sessionId][index] = applyOne(
      next[sessionId][index],
      item,
      now,
      skipText,
    );
  }
  return next;
}
