import { useEffect, useRef } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import { useDictationModel } from "../../hooks/useDictationModel";
import { dictationAvailable, useVoiceDictation } from "../chat/useVoiceDictation";

import { t } from "../../i18n";
/** Terminal event for Ctrl+Shift+M (the terminal doesn't let the key reach the window). */
export const DICTATION_TOGGLE_EVENT = "beagledock:dictation-toggle";

const clock = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;

/** Dictation in terminal mode: transcribes and pastes the text into the CLI, without sending, for review. */
export function TerminalDictationButton() {
  const { currentSession, currentProvider, workspaces, setAppError, cliTerminals } = useApp();
  const speechModel = useDictationModel(setAppError);
  const sessionId = currentSession?.id;
  const dictation = useVoiceDictation({
    onText: (text) => sessionId && void cliTerminals.pasteToTerminal(sessionId, text),
    onError: setAppError,
    onModelMissing: () =>
      setAppError(t("terminalDictation.needsModel")),
    context: () => {
      const cwd = currentSession?.cwd || "";
      const folder = cwd.split(/[\\/]/).filter(Boolean).pop();
      const workspace = workspaces.find((w) => w.path === cwd)?.name;
      return [workspace, folder, currentProvider?.name].filter((t): t is string => !!t);
    },
  });
  const toggle = async () => {
    if (dictation.state === "recording") return dictation.stop();
    if (dictation.state !== "idle" || speechModel.download) return;
    const status = await speechModel.refresh();
    if (status?.engine === "local" && !status.model.installed)
      setAppError(t("terminalDictation.needsModel"));
    else void dictation.start();
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const onToggle = () => void toggleRef.current();
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        onToggle();
      } else if (e.key === "Escape" && dictation.state === "recording") dictation.cancel();
    };
    window.addEventListener(DICTATION_TOGGLE_EVENT, onToggle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(DICTATION_TOGGLE_EVENT, onToggle);
      window.removeEventListener("keydown", onKey);
    };
  }, [dictation]);
  if (!dictationAvailable() || !currentSession) return null;
  const recording = dictation.state === "recording";
  const busy = dictation.state === "transcribing";
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      data-testid="terminal-dictation"
      aria-label={recording ? t("terminalDictation.finishLabel") : t("terminalDictation.startLabel")}
      title={recording ? t("terminalDictation.finishHint") : t("terminalDictation.startHint")}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition shadow-2xs ${
        recording
          ? "bg-rose-50 border-rose-200 text-rose-800"
          : "bg-[#ede9de] hover:bg-[#e2dcce] border-[#d6cfbe] text-[#332f28]"
      }`}
    >
      {busy ? (
        <Loader2 size={14} className="animate-spin" />
      ) : recording ? (
        <Square size={12} className="fill-current" />
      ) : (
        <Mic size={14} />
      )}
      <span>{busy ? t("composer.transcribing") : recording ? clock(dictation.seconds) : t("terminalDictation.button")}</span>
    </button>
  );
}
