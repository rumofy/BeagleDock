import { useEffect, useRef } from "react";
import type { NativeCommand } from "../../types/api";

/** Lista de comandos e skills nativos da CLI, aberta acima do campo de mensagem. */
export function CommandSuggestions({
  items,
  selected,
  loading,
  error,
  limitation,
  onPick,
  onHover,
}: {
  items: NativeCommand[];
  selected: number;
  loading: boolean;
  error?: string;
  limitation?: string;
  onPick: (command: NativeCommand) => void;
  onHover: (index: number) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <div
      data-testid="command-suggestions"
      className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-[#dcd6c7] bg-white shadow-lg overflow-hidden"
    >
      {items.length > 0 ? (
        <ul ref={listRef} role="listbox" className="max-h-64 overflow-y-auto py-1">
          {items.map((command, index) => (
            <li
              key={`${command.kind}:${command.name}`}
              role="option"
              aria-selected={index === selected}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => {
                event.preventDefault(); // mantém o foco no campo
                onPick(command);
              }}
              className={`flex items-baseline gap-2 px-3 py-1.5 cursor-pointer text-sm ${index === selected ? "bg-[#f4f1e8]" : ""}`}
            >
              <span className="font-mono text-[#1c1b18] shrink-0">/{command.name}</span>
              {command.kind !== "command" && (
                <span className="text-[10px] uppercase tracking-wide text-[#8c8270] shrink-0">
                  {command.kind === "app" ? "app" : "skill"}
                </span>
              )}
              {command.terminalOnly && (
                <span className="text-[10px] text-[#8c8270] shrink-0" title="Só funciona no terminal da CLI">
                  terminal
                </span>
              )}
              <span className="truncate text-xs text-[#7d7565]">{command.description}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-3 py-2 text-xs text-[#7d7565]">
          {loading
            ? "Lendo os comandos da CLI…"
            : error || "Nenhum comando nativo corresponde ao que foi digitado."}
        </div>
      )}
      {limitation && (
        <div className="border-t border-[#eee8d9] px-3 py-1.5 text-[11px] text-[#8c8270]">{limitation}</div>
      )}
    </div>
  );
}
