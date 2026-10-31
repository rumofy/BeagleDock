import { memo, useMemo } from "react";
import { splitFileLinks } from "../lib/fileLinks";

export interface FileTarget {
  path: string;
  line?: number;
  column?: number;
}

/** Texto da resposta com referências a arquivos (`src/app.ts:42`) clicáveis. */
export const LinkedText = memo(function LinkedText({
  text,
  onOpenFile,
}: {
  text: string;
  onOpenFile?: (target: FileTarget) => void;
}) {
  const parts = useMemo(
    () => (onOpenFile ? splitFileLinks(text) : null),
    [text, onOpenFile],
  );
  if (!parts || !onOpenFile) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.type === "text" ? (
          <span key={index}>{part.value}</span>
        ) : (
          <button
            key={index}
            type="button"
            onClick={() =>
              onOpenFile({
                path: part.path,
                line: part.line,
                column: part.column,
              })
            }
            title="Abrir no VS Code"
            className="font-mono text-[0.92em] underline decoration-dotted underline-offset-2 text-[#8a4b0f] hover:text-[#b45309] cursor-pointer"
          >
            {part.value}
          </button>
        ),
      )}
    </>
  );
});
