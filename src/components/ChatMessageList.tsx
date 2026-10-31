import { Paperclip } from "lucide-react";
import { ChatActivity } from "./ChatActivity";
import { CompanyIcon } from "./CompanyIcon";
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

export function ChatMessageList({
  messages,
  userProfile,
  compact = false,
}: {
  messages: ChatMessage[];
  userProfile: Pick<UserProfile, "fullName" | "initials">;
  compact?: boolean;
}) {
  return (
    <>
      {messages.map((msg) => (
        <div key={msg.id} className="flex gap-3">
          {msg.sender === "user" ? (
            <div
              className="w-8 h-8 rounded-xl bg-[#262420] text-amber-200 flex items-center justify-center font-bold text-xs shrink-0 shadow-xs ring-1 ring-[#e4dec9]"
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

            <div
              className={`text-sm text-[#2e2a24] leading-relaxed bg-[#f4f1e8]/60 border border-[#eae4d7] rounded-2xl shadow-2xs space-y-3 overflow-x-auto ${compact ? "p-2.5" : "p-3.5"}`}
            >
              {msg.text && (
                <div className="whitespace-pre-wrap break-words font-sans">
                  {msg.text}
                </div>
              )}

              {msg.isStreaming && (
                <ChatActivity text={msg.activity} startedAt={msg.startedAt} />
              )}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2.5 pt-1">
                  {msg.attachments.map((att) => (
                    <div
                      key={att.id}
                      className="overflow-hidden rounded-xl border border-[#dcd6c7] bg-[#ffffff] shadow-2xs max-w-sm"
                    >
                      {att.type === "image" ? (
                        <div>
                          <img
                            src={att.url}
                            alt={att.name}
                            className="max-h-64 w-auto object-cover rounded-t-xl hover:opacity-95 cursor-pointer"
                            onClick={() => window.open(att.url, "_blank")}
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
      ))}
    </>
  );
}
