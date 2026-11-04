import { memo, useMemo } from "react";
import { beagleApi } from "../api/beagleApi";
import { splitFileLinks } from "../lib/fileLinks";

import { t } from "../i18n";
export interface FileTarget {
  path: string;
  line?: number;
  column?: number;
}

/** Reply text with clickable file references (`src/app.ts:42`) and web addresses. */
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
        ) : part.type === "url" ? (
          <button
            key={index}
            type="button"
            onClick={() => void beagleApi.openExternalUrl(part.url).catch(() => {})}
            title={t("links.openInBrowser", { url: part.url })}
            className="text-[0.95em] underline underline-offset-2 text-[#8a4b0f] hover:text-[#b45309] cursor-pointer break-all text-left"
          >
            {part.value}
          </button>
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
            title={t("links.openInVsCode")}
            className="font-mono text-[0.92em] underline decoration-dotted underline-offset-2 text-[#8a4b0f] hover:text-[#b45309] cursor-pointer"
          >
            {part.value}
          </button>
        ),
      )}
    </>
  );
});
