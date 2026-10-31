import { useEffect, useRef } from "react";

/** Arquivos do projeto sugeridos para o `@arquivo`, abertos acima do campo de mensagem. */
export function FileSuggestions({
  files,
  selected,
  loading,
  error,
  onPick,
  onHover,
}: {
  files: string[];
  selected: number;
  loading: boolean;
  error?: string;
  onPick: (file: string) => void;
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
      data-testid="file-suggestions"
      className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-[#dcd6c7] bg-white shadow-lg overflow-hidden"
    >
      {files.length > 0 ? (
        <ul ref={listRef} role="listbox" aria-label="Arquivos do projeto" className="max-h-64 overflow-y-auto py-1">
          {files.map((file, index) => {
            const slash = file.lastIndexOf("/");
            return (
              <li
                key={file}
                role="option"
                aria-selected={index === selected}
                onMouseEnter={() => onHover(index)}
                onMouseDown={(event) => {
                  event.preventDefault(); // mantém o foco no campo
                  onPick(file);
                }}
                className={`flex items-baseline gap-2 px-3 py-1.5 cursor-pointer text-sm ${index === selected ? "bg-[#f4f1e8]" : ""}`}
              >
                <span className="font-mono text-[#1c1b18] shrink-0">{file.slice(slash + 1)}</span>
                {slash >= 0 && (
                  <span className="truncate text-xs font-mono text-[#7d7565]">{file.slice(0, slash)}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-3 py-2 text-xs text-[#7d7565]">
          {loading ? "Procurando arquivos…" : error || "Nenhum arquivo do projeto corresponde."}
        </div>
      )}
    </div>
  );
}
