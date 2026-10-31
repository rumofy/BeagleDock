import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
function colors(text: string) {
  if (text.includes("\x1b")) return text;
  return text
    .split(/(?<=\n)/)
    .map((line) => {
      const color = /^\s*\$/.test(line)
        ? "33"
        : /\b(error|failed|failure|erro|falhou)\b/i.test(line)
          ? "31"
          : /\b(passed|success|sucesso|passaram)\b|✓/.test(line)
            ? "32"
            : /\b(warn|warning|queued|pending)\b/i.test(line)
              ? "33"
              : /Test Files|Tests|Duration|Start at|src\//.test(line)
                ? "36"
                : "37";
      return `\x1b[${color}m${line}\x1b[0m`;
    })
    .join("");
}
export function LiveShell({
  sessionId,
  text,
}: {
  sessionId: string;
  text: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null),
    previous = useRef("");
  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      fontSize: 12,
      fontFamily: "monospace",
      scrollback: 5000,
      theme: {
        background: "#18181b",
        foreground: "#e4e4e7",
        black: "#27272a",
        red: "#fb7185",
        green: "#34d399",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e4e4e7",
      },
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    terminal.current = term;
    previous.current = "";
    const resize = new ResizeObserver(() => {
      if (host.current?.clientWidth && host.current.clientHeight) fit.fit();
    });
    resize.observe(host.current);
    fit.fit();
    return () => {
      resize.disconnect();
      terminal.current = null;
      term.dispose();
    };
  }, [sessionId]);
  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    if (!text.startsWith(previous.current)) {
      term.reset();
      previous.current = "";
    }
    const delta = text.slice(previous.current.length);
    previous.current = text;
    if (delta) term.write(colors(delta), () => term.scrollToBottom());
  }, [text, sessionId]);
  return (
    <div
      data-testid="live-shell"
      aria-label="Saída ao vivo da CLI"
      ref={host}
      className="flex-1 min-h-0 overflow-hidden p-2 bg-[#18181b]"
    />
  );
}
