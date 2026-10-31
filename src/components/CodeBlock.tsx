import { memo, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { tokenize, type TokenType } from "../lib/highlight";

const COLOR: Record<TokenType, string> = {
  plain: "text-[#2e2a24]",
  keyword: "text-[#8a2f9a] font-semibold",
  string: "text-[#2f7d3b]",
  comment: "text-[#7d7565] italic",
  number: "text-[#b4540a]",
  function: "text-[#1d5fa8]",
  property: "text-[#1d5fa8]",
  add: "text-[#1c7a34] bg-[#e1f5e5]",
  del: "text-[#b42318] bg-[#fde6e3]",
  meta: "text-[#7d7565] font-semibold",
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Bloco de código com destaque de sintaxe e botão "copiar". Memoizado: só o bloco que cresce re-renderiza. */
export const CodeBlock = memo(function CodeBlock({
  code,
  lang,
  streaming,
}: {
  code: string;
  lang: string;
  streaming?: boolean;
}) {
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const tokens = useMemo(() => tokenize(code, lang), [code, lang]);
  return (
    <div
      className="not-prose my-2 rounded-xl border border-[#dcd6c7] bg-[#f4f1e8] overflow-hidden"
      data-testid="code-block"
    >
      <div className="flex items-center justify-between px-3 py-1 bg-[#ebe6d9] border-b border-[#dcd6c7]">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#6d6657]">
          {lang || "código"}
          {streaming ? " · recebendo…" : ""}
        </span>
        <button
          type="button"
          onClick={async () => {
            setCopied((await copyText(code)) ? "ok" : "fail");
            setTimeout(() => setCopied("idle"), 1800);
          }}
          className="flex items-center gap-1 text-[10px] font-bold text-[#443e33] hover:text-[#181715]"
          aria-label="Copiar código"
        >
          {copied === "ok" ? <Check size={12} /> : <Copy size={12} />}
          {copied === "ok"
            ? "Copiado"
            : copied === "fail"
              ? "Não foi possível copiar"
              : "Copiar"}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-[12px] leading-relaxed font-mono whitespace-pre">
        <code>
          {tokens.map((token, index) => (
            <span key={index} className={COLOR[token.type]}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
});
