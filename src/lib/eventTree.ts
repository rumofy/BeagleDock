import type { ChatEvent } from "../types";

/** Groups agent steps under the agent that started them; orphan or cyclic steps stay at the root. */
export function buildEventTree(events: ChatEvent[]): {
  roots: ChatEvent[];
  tree: Map<string, ChatEvent[]>;
} {
  const ids = new Set(events.map((e) => e.id));
  const parentOf = new Map(events.map((e) => [e.id, e.parentId]));
  const cyclic = (event: ChatEvent) => {
    const seen = new Set<string>([event.id]);
    let current = event.parentId;
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = parentOf.get(current);
    }
    return false;
  };
  const tree = new Map<string, ChatEvent[]>();
  const roots: ChatEvent[] = [];
  for (const event of events) {
    if (event.parentId && ids.has(event.parentId) && !cyclic(event))
      tree.set(event.parentId, [...(tree.get(event.parentId) ?? []), event]);
    else roots.push(event);
  }
  return { roots, tree };
}
