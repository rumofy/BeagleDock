import { useEffect, useState } from "react";
export function ChatActivity({
  text,
  startedAt,
}: {
  text?: string;
  startedAt?: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - (startedAt || now)) / 1000));
  return (
    <div
      role="status"
      className="text-[11px] text-[#7d7565] flex items-center gap-2 pt-2"
    >
      <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
      {text || "Aguardando a CLI…"}
      <span className="font-mono">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
      </span>
    </div>
  );
}
