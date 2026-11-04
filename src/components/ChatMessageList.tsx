import { memo } from "react";
import { OctagonX, Paperclip, Trash2, Zap } from "lucide-react";
import { ChatActivity } from "./ChatActivity";
import { CompanyIcon } from "./CompanyIcon";
import { ChatTimeline } from "./ChatTimeline";
import { MessageBody } from "./MessageBody";
import type { FileTarget } from "./LinkedText";
import { messageSegments } from "../lib/messageSegments";
import type { ChatMessage, ReasoningEffortLevel, UserProfile } from "../types";

export function reasoningBadgeClass(effort: ReasoningEffortLevel) {
  switch (effort) {
    case "low":
      return "text-sky-700 bg-sky-100/70 border-sky-200";
    case "medium":
      return "text-amber-700 bg-amber-100/70 border-amber-200";
    case "high":
      return "text-purple-700 bg-purple-100/70 border-purple-200";
    case "plan":
      return "text-emerald-700 bg-emerald-100/70 border-emerald-200";
    default:
      return "text-[#665e4f] bg-[#f4f1e8] border-[#dfdacd]";
  }
}

type RowProps = {
  onOpenFile?: (target: FileTarget) => void;
  msg: ChatMessage;
  userProfile: Pick<UserProfile, "fullName" | "initials">;
  compact: boolean;
  onForceQueued?: (msg: ChatMessage) => void;
  onCancelQueued?: (msg: ChatMessage) => void;
  onAnswerNow?: (msg: ChatMessage, mode: "background" | "interrupt") => void;
};

// Só a mensagem em streaming muda de identidade a cada pedaço; as demais não re-renderizam.
const MessageRow = memo(
  function MessageRow({
    msg,
    userProfile,
    compact,
    onOpenFile,
    onForceQueued,
    onCancelQueued,
    onAnswerNow,
  }: RowProps) {
    const backgroundAgents =
      msg.events?.filter((e) => e.kind === "agent" && e.status === "running")
        .length ?? 0;
    const backgroundCommands =
      msg.events?.filter(
        (e) =>
          e.kind === "command" &&
          e.status === "running" &&
          e.meta?.background === true,
      ).length ?? 0;
    const segments = messageSegments(msg.text || "");
    const earlier = segments.slice(0, -1);
    const lastSegment = segments.at(-1) || "";
    const boxClass = `text-sm text-[#2e2a24] leading-relaxed bg-[#f4f1e8]/60 border border-[#eae4d7] rounded-2xl shadow-2xs space-y-3 overflow-x-auto ${compact ? "p-2.5" : "p-3.5"}`;
    return (
      <div key={msg.id} className="flex gap-3">
        {msg.sender === "user" ? (
          <div
            className="w-8 h-8 rounded-xl bg-[#262420] text-amber-50 flex items-center justify-center font-bold text-xs shrink-0 shadow-xs ring-1 ring-[#e4dec9]"
            title={userProfile.fullName}
          >
            {userProfile.initials || "U"}
          </div>
        ) : (
          <CompanyIcon id={msg.sender} size={30} className="shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1 flex-wrap">
            <span className="font-bold text-sm text-[#1f1d19]">
              {msg.senderName}
            </span>
            {msg.modelBadge && (
              <span className="text-[11px] font-medium text-[#7d7565] bg-[#ece7db] px-2 py-0.5 rounded-md">
                {msg.modelBadge}
              </span>
            )}
            {msg.reasoningBadge && (
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${reasoningBadgeClass(msg.reasoningBadge)}`}
              >
                {msg.reasoningBadge}
              </span>
            )}
            <span className="text-xs text-[#9d9483]">{msg.timestamp}</span>
          </div>

          {/* Cada trecho de texto da resposta é uma caixa própria: o que já foi lido fica separado do novo. */}
          {earlier.map((segment, index) => (
            <div key={index} className={`${boxClass} mb-2`} data-testid="message-segment">
              {index === 0 && msg.events && msg.events.length > 0 && (
                <ChatTimeline events={msg.events} streaming={!!msg.isStreaming} />
              )}
              <div className="whitespace-pre-wrap break-words font-sans">
                <MessageBody
                  text={segment}
                  onOpenFile={msg.sender === "user" ? undefined : onOpenFile}
                />
              </div>
            </div>
          ))}
          <div className={boxClass} data-testid="message-segment">
            {earlier.length === 0 && msg.events && msg.events.length > 0 && (
              <ChatTimeline events={msg.events} streaming={!!msg.isStreaming} />
            )}

            {lastSegment && (
              <div className="whitespace-pre-wrap break-words font-sans">
                <MessageBody
                  text={lastSegment}
                  onOpenFile={msg.sender === "user" ? undefined : onOpenFile}
                />
              </div>
            )}

            {msg.isStreaming && (
              <ChatActivity
                text={msg.activity}
                detail={msg.detail}
                startedAt={msg.startedAt}
                activitySince={msg.activitySince}
                lastEventAt={msg.lastEventAt}
                lastProgressAt={msg.lastProgressAt}
              />
            )}
            {msg.queuedFor && (onForceQueued || onCancelQueued) && (
              <div className="flex items-center gap-2" data-testid="queued-actions">
                {onForceQueued && (
                  <button
                    type="button"
                    onClick={() => onForceQueued(msg)}
                    title="Interrompe a execução atual e envia esta mensagem agora"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-[11px] font-bold text-amber-800"
                  >
                    <Zap size={12} /> Enviar agora
                  </button>
                )}
                {onCancelQueued && (
                  <button
                    type="button"
                    onClick={() => onCancelQueued(msg)}
                    title="Remove a mensagem da fila antes de a IA lê-la"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#d6cfbe] bg-[#f4f1e8] hover:bg-[#ede9de] text-[11px] font-bold text-[#665e4f]"
                  >
                    <Trash2 size={12} /> Remover da fila
                  </button>
                )}
              </div>
            )}
            {msg.isStreaming && msg.deliveredFor && onAnswerNow && (
              <div className="flex flex-wrap items-center gap-2" data-testid="delivered-actions">
                {msg.sender === "claude" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onAnswerNow(msg, "background")}
                      title="O comando em execução vai para o segundo plano e continua rodando; a IA responde a sua mensagem agora"
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-[11px] font-bold text-amber-800"
                    >
                      <Zap size={12} /> Responder agora
                    </button>
                    <button
                      type="button"
                      onClick={() => onAnswerNow(msg, "interrupt")}
                      title="Cancela a etapa em execução (inclusive o comando) e a IA responde a sua mensagem"
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#d6cfbe] bg-[#f4f1e8] hover:bg-[#ede9de] text-[11px] font-bold text-[#665e4f]"
                    >
                      <OctagonX size={12} /> Interromper e responder
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => onAnswerNow(msg, "interrupt")}
                    title="O Codex não manda comandos para o segundo plano: interrompe a etapa em execução (inclusive o comando) e responde a sua mensagem"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-[11px] font-bold text-amber-800"
                  >
                    <Zap size={12} /> Interromper e responder
                  </button>
                )}
              </div>
            )}
            {!msg.isStreaming && backgroundAgents > 0 && (
              <div
                role="status"
                data-testid="background-agents"
                className="flex items-center gap-2 text-[11px] font-medium text-amber-700"
              >
                <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-amber-500 animate-pulse" />
                {backgroundAgents === 1
                  ? "1 agente ainda trabalhando em segundo plano"
                  : `${backgroundAgents} agentes ainda trabalhando em segundo plano`}
              </div>
            )}
            {!msg.isStreaming && backgroundCommands > 0 && (
              <div
                role="status"
                data-testid="background-commands"
                className="flex items-center gap-2 text-[11px] font-medium text-amber-700"
              >
                <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-amber-500 animate-pulse" />
                {backgroundCommands === 1
                  ? "1 comando ainda rodando em segundo plano: a IA aguarda o aviso de conclusão"
                  : `${backgroundCommands} comandos ainda rodando em segundo plano: a IA aguarda o aviso de conclusão`}
              </div>
            )}
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2.5 pt-1">
                {msg.attachments.map((att) => (
                  <div
                    key={att.id}
                    className="overflow-hidden rounded-xl border border-[#dcd6c7] bg-[#ffffff] shadow-2xs max-w-sm"
                  >
                    {att.type === "image" && att.url ? (
                      <div>
                        <img
                          src={att.url}
                          alt={att.name}
                          className="max-h-64 w-auto object-cover rounded-t-xl"
                        />
                        <div className="px-2.5 py-1.5 flex items-center justify-between text-[11px] text-[#7d7565] bg-[#faf8f4]">
                          <span className="truncate max-w-[180px] font-medium">
                            {att.name}
                          </span>
                          <span className="font-mono text-[10px]">
                            {att.sizeText}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 flex items-center gap-2.5">
                        <Paperclip size={16} className="text-[#8c8270]" />
                        <div>
                          <div className="text-xs font-bold text-[#2e2a24]">
                            {att.name}
                          </div>
                          <div className="text-[10px] font-mono text-[#8c8270]">
                            {att.sizeText}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {msg.commandSnippet && (
              <div className="mt-2.5 pt-2 border-t border-[#dfdacd] flex items-center justify-between font-mono text-xs text-[#b45309]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                  <span className="truncate max-w-lg">
                    {msg.commandSnippet}
                  </span>
                </div>
                <span className="text-[10px] text-[#7e7565]">CLI / SQLite</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
  (a, b) =>
    a.msg === b.msg &&
    a.compact === b.compact &&
    a.onOpenFile === b.onOpenFile &&
    a.onForceQueued === b.onForceQueued &&
    a.onCancelQueued === b.onCancelQueued &&
    a.onAnswerNow === b.onAnswerNow &&
    a.userProfile.fullName === b.userProfile.fullName &&
    a.userProfile.initials === b.userProfile.initials,
);

export function ChatMessageList({
  messages,
  userProfile,
  compact = false,
  onOpenFile,
  onForceQueued,
  onCancelQueued,
  onAnswerNow,
}: {
  messages: ChatMessage[];
  userProfile: Pick<UserProfile, "fullName" | "initials">;
  compact?: boolean;
  onOpenFile?: (target: FileTarget) => void;
  onForceQueued?: (msg: ChatMessage) => void;
  onCancelQueued?: (msg: ChatMessage) => void;
  onAnswerNow?: (msg: ChatMessage, mode: "background" | "interrupt") => void;
}) {
  // "Enviar agora" só vale para a próxima mensagem da fila (a primeira que ainda espera).
  const nextQueuedId = messages.find((m) => m.queuedFor)?.id;
  return (
    <>
      {messages.map((msg) => (
        <MessageRow
          key={msg.id}
          msg={msg}
          userProfile={userProfile}
          compact={compact}
          onOpenFile={onOpenFile}
          onForceQueued={msg.id === nextQueuedId ? onForceQueued : undefined}
          onCancelQueued={onCancelQueued}
          onAnswerNow={onAnswerNow}
        />
      ))}
    </>
  );
}
