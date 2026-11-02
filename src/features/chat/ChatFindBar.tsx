import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

type Props = {
  query: string;
  onQuery: (value: string) => void;
  total: number;
  current: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  /** Muda a cada Ctrl+F para devolver o foco e selecionar o texto, mesmo com a barra já aberta. */
  focusToken: number;
};

/** Barra de busca na conversa (Ctrl+F). Enter/F3 avança, Shift+Enter/Shift+F3 volta, Esc fecha. */
export function ChatFindBar({ query, onQuery, total, current, onNext, onPrev, onClose, focusToken }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const status = !query.trim() ? "" : total === 0 ? "Nenhum resultado" : `${current + 1} de ${total}`;
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
        placeholder="Buscar na conversa"
        aria-label="Buscar na conversa"
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
      <button type="button" onClick={onPrev} disabled={total === 0} className={button} title="Anterior (Shift+Enter)" aria-label="Ocorrência anterior">
        <ChevronUp size={15} />
      </button>
      <button type="button" onClick={onNext} disabled={total === 0} className={button} title="Próxima (Enter)" aria-label="Próxima ocorrência">
        <ChevronDown size={15} />
      </button>
      <button type="button" onClick={onClose} className={button} title="Fechar (Esc)" aria-label="Fechar busca">
        <X size={15} />
      </button>
    </div>
  );
}
