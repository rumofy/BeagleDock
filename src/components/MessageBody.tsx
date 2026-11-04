import { memo, useMemo } from "react";
import { splitMessage } from "../lib/codeBlocks";
import { CodeBlock } from "./CodeBlock";
import { LinkedText, type FileTarget } from "./LinkedText";

/** Reply text: code blocks with highlighting and copy; the rest with file links. */
export const MessageBody = memo(function MessageBody({
  text,
  onOpenFile,
}: {
  text: string;
  onOpenFile?: (target: FileTarget) => void;
}) {
  const parts = useMemo(() => splitMessage(text), [text]);
  if (parts.length === 1 && parts[0].type === "text")
    return <LinkedText text={text} onOpenFile={onOpenFile} />;
  return (
    <>
      {parts.map((part, index) =>
        part.type === "code" ? (
          <CodeBlock
            key={index}
            code={part.code}
            lang={part.lang}
            streaming={!part.closed}
          />
        ) : (
          <LinkedText key={index} text={part.value} onOpenFile={onOpenFile} />
        ),
      )}
    </>
  );
});
