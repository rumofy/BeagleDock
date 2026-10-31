import { useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { transformWikiLinks } from "./memoryUtils";

export function MarkdownView({
  body,
  onWikiLink,
}: {
  body: string;
  onWikiLink: (target: string) => void;
}) {
  const source = useMemo(() => transformWikiLinks(body), [body]);
  return (
    <div className="text-sm text-[#2e2a24] leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          url.startsWith("wiki:") ? url : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, children }) =>
            href?.startsWith("wiki:") ? (
              <button
                type="button"
                onClick={() => onWikiLink(decodeURIComponent(href.slice(5)))}
                className="text-indigo-700 underline decoration-dotted hover:text-indigo-900"
              >
                {children}
              </button>
            ) : (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-700 underline"
              >
                {children}
              </a>
            ),
          h1: (p) => <h1 className="text-xl font-extrabold mt-4 mb-2" {...p} />,
          h2: (p) => <h2 className="text-lg font-bold mt-4 mb-2" {...p} />,
          h3: (p) => <h3 className="text-base font-bold mt-3 mb-1.5" {...p} />,
          h4: (p) => <h4 className="text-sm font-bold mt-3 mb-1" {...p} />,
          p: (p) => <p className="my-2" {...p} />,
          ul: (p) => <ul className="list-disc pl-5 my-2 space-y-1" {...p} />,
          ol: (p) => <ol className="list-decimal pl-5 my-2 space-y-1" {...p} />,
          blockquote: (p) => (
            <blockquote
              className="border-l-4 border-[#d8d2c3] pl-3 my-2 text-[#6d6657]"
              {...p}
            />
          ),
          hr: () => <hr className="my-3 border-[#e6e1d5]" />,
          pre: (p) => (
            <pre
              className="bg-[#f4f1e8] border border-[#e6e1d5] rounded-xl p-3 my-2 overflow-x-auto text-xs font-mono"
              {...p}
            />
          ),
          code: (p) => (
            <code
              className="bg-[#f4f1e8] rounded px-1 py-0.5 text-[12px] font-mono"
              {...p}
            />
          ),
          table: (p) => (
            <div className="overflow-x-auto my-2">
              <table className="text-xs border-collapse" {...p} />
            </div>
          ),
          th: (p) => (
            <th
              className="border border-[#dfdacd] bg-[#f4f1e8] px-2 py-1 text-left"
              {...p}
            />
          ),
          td: (p) => <td className="border border-[#dfdacd] px-2 py-1" {...p} />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
