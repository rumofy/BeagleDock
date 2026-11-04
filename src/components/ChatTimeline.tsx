import { memo, useMemo, useState } from "react";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  FilePen,
  Globe,
  ListChecks,
  Loader2,
  Plug,
  Shrink,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { useNow } from "../hooks/useNow";
import { formatDuration } from "../lib/duration";
import { buildEventTree } from "../lib/eventTree";
import { formatTokens } from "../lib/tokens";
import type { ChatEvent, ChatEventKind } from "../types";

import { t, tn, type MessageKey } from "../i18n";
const KIND_ICON: Record<ChatEventKind, typeof Brain> = {
  reasoning: Brain,
  command: Terminal,
  tool: Wrench,
  mcp: Plug,
  file: FilePen,
  web: Globe,
  plan: ListChecks,
  agent: Bot,
  compaction: Shrink,
  status: Circle,
  step: Circle,
};

// Read on every render, so it follows the interface language.
const kindLabel = (kind: ChatEventKind) => t(`timeline.kind.${kind}` as MessageKey);

const EventRow = memo(function EventRow({
  event,
  now,
  children,
  tree,
  depth = 0,
}: {
  event: ChatEvent;
  now: number;
  children: ChatEvent[];
  tree: Map<string, ChatEvent[]>;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = KIND_ICON[event.kind] ?? Circle;
  const running = event.status === "running";
  const elapsed = running
    ? now - (event.startedAt ?? now)
    : (event.durationMs ?? 0);
  const hasText = !!event.text;
  return (
    <li className="py-1 min-w-0 overflow-hidden">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`shrink-0 ${event.status === "error" ? "text-rose-600" : running ? "text-amber-600" : "text-[#8c8270]"}`}
          aria-hidden
        >
          <Icon size={13} />
        </span>
        <span className="text-[11px] font-semibold text-[#3d382e] truncate max-w-[45%]" title={event.title || kindLabel(event.kind)}>
          {event.title || kindLabel(event.kind)}
        </span>
        {event.detail && (
          <span
            className="text-[11px] font-mono text-[#7d7565] truncate min-w-0"
            title={event.detail}
          >
            {event.detail}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 shrink-0 text-[10px] font-mono tabular-nums text-[#938b7a]">
          {elapsed > 0 && formatDuration(elapsed)}
          {event.exitCode !== undefined && event.exitCode !== 0 && (
            <span className="text-rose-600">exit {event.exitCode}</span>
          )}
          {running ? (
            <Loader2
              size={12}
              className="animate-spin text-amber-600"
              aria-label={t("timeline.running")}
            />
          ) : event.status === "error" ? (
            <X size={12} className="text-rose-600" aria-label={t("timeline.failed")} />
          ) : (
            <Check
              size={12}
              className="text-emerald-600"
              aria-label={t("timeline.done")}
            />
          )}
        </span>
      </div>
      {event.meta?.note && (
        <div className="ml-5 mt-0.5 text-[10px] italic text-amber-800">
          ⚠ {event.meta.note}
        </div>
      )}
      {event.kind === "agent" && event.meta && (
        <div className="ml-5 mt-0.5 text-[10px] font-mono text-[#8c8270]">
          {[
            event.meta.subagentType,
            Number.isFinite(event.meta.toolUses)
              ? tn("timeline.tools", event.meta.toolUses ?? 0)
              : "",
            Number.isFinite(event.meta.tokens)
              ? `${formatTokens(event.meta.tokens)} tokens`
              : "",
            event.meta.lastTool && event.status === "running"
              ? t("timeline.now", { tool: event.meta.lastTool })
              : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
      {hasText && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 ml-5 block text-left w-[calc(100%-1.25rem)] overflow-hidden"
          aria-expanded={expanded}
        >
          <span
            className={`block text-[11px] italic text-[#7d7565] whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-2"}`}
          >
            {event.text}
          </span>
        </button>
      )}
      {children.length > 0 && (
        <ul
          className="ml-3 mt-1 pl-3 border-l-2 border-[#e4dec9] divide-y divide-[#eee8d9]"
          aria-label={t("timeline.stepsOf", { name: event.title || t("timeline.agentFallback") })}
        >
          {children.map((child) => (
            <EventRow
              key={child.id}
              event={child}
              now={now}
              children={tree.get(child.id) ?? []}
              tree={tree}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
});

export const ChatTimeline = memo(function ChatTimeline({
  events,
  streaming,
}: {
  events: ChatEvent[];
  streaming: boolean;
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const running = events.filter((e) => e.status === "running").length;
  // Open while the reply arrives or while something (an agent) is still working.
  const open = userOpen ?? (streaming || running > 0);
  const { roots, tree } = useMemo(() => buildEventTree(events), [events]);
  const agents = events.filter((e) => e.kind === "agent").length;
  const failed = events.filter((e) => e.status === "error").length;
  const now = useNow(open && running > 0);
  return (
    <div
      className="min-w-0 rounded-xl border border-[#e4dec9] bg-[#faf8f4] px-2.5 py-1.5"
      data-testid="chat-timeline"
    >
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] font-bold text-[#665e4f] w-full whitespace-nowrap"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {t("timeline.activity")}
        <span className="font-normal text-[#938b7a] truncate min-w-0">
          · {tn("timeline.steps", events.length)}
          {agents > 0
            ? ` · ${tn("background.agents", agents)}`
            : ""}
          {running > 0 ? ` · ${t("timeline.inProgress", { count: running })}` : ""}
          {failed > 0 ? ` · ${t("timeline.withError", { count: failed })}` : ""}
        </span>
      </button>
      {open && (
        <ul
          data-testid="chat-timeline-steps"
          className={`mt-1 min-w-0 divide-y divide-[#eee8d9] overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] ${streaming || running > 0 ? "h-72" : "max-h-72"}`}
        >
          {roots.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              now={now}
              children={tree.get(event.id) ?? []}
              tree={tree}
            />
          ))}
        </ul>
      )}
    </div>
  );
});
