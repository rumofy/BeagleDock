import { useLayoutEffect, useRef, useState } from "react";
import { ExternalLink, Send, Square, X } from "lucide-react";
import { ApprovalCard } from "../../components/ApprovalCard";
import { ChatMessageList } from "../../components/ChatMessageList";
import type { ChatMessage, ChatSession, UserProfile } from "../../types";
import type { CliApproval } from "../../types/api";

import { t } from "../../i18n";
export interface MaintenanceChat {
  session: ChatSession;
  messages: ChatMessage[];
  executing: boolean;
  stopping: boolean;
  approvals: CliApproval[];
  onSend: (text: string) => void;
  onStop: () => void;
  onResolveApproval: (id: string, decision: string, message?: string) => void;
  onOpenInChat: () => void;
  onClose: () => void;
}

export function MaintenanceChatPane({
  chat,
  userProfile,
}: {
  chat: MaintenanceChat;
  userProfile: UserProfile;
}) {
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.approvals.length]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    chat.onSend(value);
  };
  return (
    <div
      className="flex flex-col h-full min-h-0"
      data-testid="maintenance-chat"
    >
      <div className="px-3 py-2 border-b border-[#eeeae0] flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-[#1c1b18] truncate">
            {chat.session.title}
          </div>
          <div className="text-[10px] text-[#8c8270]">
            {chat.executing ? t("maintenance.running") : t("maintenance.waitingYou")} ·{" "}
            {chat.session.currentModel || t("stale.cliDefault")}
          </div>
        </div>
        <button
          onClick={chat.onOpenInChat}
          className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-[#f4f1e8] hover:bg-[#eae4d5] border border-[#dfdacd] flex items-center gap-1"
        >
          <ExternalLink size={12} /> {t("maintenance.openInChat")}
        </button>
        <button
          onClick={chat.onClose}
          title={t("maintenance.closePane")}
          className="p-1 rounded-lg hover:bg-[#ede9de] text-[#6d6657]"
        >
          <X size={14} />
        </button>
      </div>
      <div
        ref={scroller}
        className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4"
      >
        <ChatMessageList
          messages={chat.messages}
          userProfile={userProfile}
          compact
        />
      </div>
      {chat.approvals.map((a) => (
        <div key={a.id} className="mx-3 mb-2">
          <ApprovalCard
            approval={a}
            onResolve={chat.onResolveApproval}
            compact
          />
        </div>
      ))}
      <form
        onSubmit={submit}
        className="m-3 mt-0 flex items-center gap-2 bg-white border border-[#dcd6c7] focus-within:border-[#968d7a] rounded-2xl p-1.5 shadow-sm"
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("maintenance.replyPlaceholder")}
          className="flex-1 min-w-0 px-2 py-1.5 text-sm bg-transparent outline-none placeholder-[#9c9381]"
        />
        {chat.executing && (
          <button
            type="button"
            disabled={chat.stopping}
            onClick={chat.onStop}
            className="px-2.5 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-xs font-bold flex gap-1 items-center"
          >
            <Square size={11} /> {chat.stopping ? t("composer.stopping") : t("composer.stop")}
          </button>
        )}
        <button
          type="submit"
          disabled={!text.trim()}
          className="p-2 rounded-xl bg-[#1c1b18] hover:bg-[#32302b] disabled:opacity-30 text-white"
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
