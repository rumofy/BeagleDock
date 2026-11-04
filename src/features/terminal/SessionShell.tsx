import { LiveShell } from "../../components/LiveShell";
import { useApp } from "../../hooks/AppStateProvider";

/** Conversation shell: a single stream with all the output, always following the end. */
export function SessionShell({ sessionId }: { sessionId: string }) {
  const { currentSession } = useApp();
  const raw = currentSession?.ptyRaw || (currentSession?.ptyLog || []).join("\r\n");
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <LiveShell sessionId={`${sessionId}:all`} text={raw} />
    </div>
  );
}
