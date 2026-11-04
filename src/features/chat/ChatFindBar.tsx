import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

import { t } from "../../i18n";
type Props = {
  query: string;
  onQuery: (value: string) => void;
  total: number;
  current: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  /** Changes on every Ctrl+F to refocus and select the text, even with the bar already open. */
  focusToken: number;
};

/** Conversation search bar (Ctrl+F). Enter/F3 goes forward, Shift+Enter/Shift+F3 back, Esc closes. */
export function ChatFindBar({ query, onQuery, total, current, onNext, onPrev, onClose, focusToken }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const status = !query.trim() ? "" : total === 0 ? t("find.noResults") : t("find.position", { current: current + 1, total });
  const button =
    "p-1 rounded-md text-[#665e4f] hover:bg-[#ede9de] disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div
      role="search"
      data-testid="chat-find"
      className="absolute top-3 right-8 z-[45] flex items-center gap-1.5 rounded-xl border border-[#dcd6c7] bg-[#ffffff] pl-2.5 pr-1.5 py-1.5 shadow-lg"
    >
      <Search size={14} className="text-[#8c8270] shrink-0" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "F3") {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        placeholder={t("find.placeholder")}
        aria-label={t("find.placeholder")}
        spellCheck={false}
        className="w-56 bg-transparent text-sm text-[#2e2a24] outline-none"
      />
      <span
        aria-live="polite"
        data-testid="chat-find-status"
        className={`min-w-[5.5rem] text-right text-[11px] font-medium tabular-nums ${total === 0 && query.trim() ? "text-red-600" : "text-[#8c8270]"}`}
      >
        {status}
      </span>
      <button type="button" onClick={onPrev} disabled={total === 0} className={button} title={t("find.prevHint")} aria-label={t("find.prev")}>
        <ChevronUp size={15} />
      </button>
      <button type="button" onClick={onNext} disabled={total === 0} className={button} title={t("find.nextHint")} aria-label={t("find.next")}>
        <ChevronDown size={15} />
      </button>
      <button type="button" onClick={onClose} className={button} title={t("find.closeHint")} aria-label={t("find.close")}>
        <X size={15} />
      </button>
    </div>
  );
}
