import {
  Send,
  Square,
  Paperclip,
  X,
  ArrowRightLeft,
  Zap,
  Compass,
  Wand2,
  Clock,
  Mic,
  Check,
  Loader2,
  Download,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../../hooks/AppStateProvider";
import { useNativeCommands } from "../../hooks/useNativeCommands";
import { controlForCommand, openSessionControl } from "../../lib/sessionControls";
import { CommandSuggestions } from "./CommandSuggestions";
import { FileSuggestions } from "./FileSuggestions";
import { useProjectFiles } from "../../hooks/useProjectFiles";
import { applyMention, mentionAt } from "../../lib/attachments";
import { insertDictation } from "../../lib/wav";
import { dictationAvailable, useVoiceDictation } from "./useVoiceDictation";
import { formatMegabytes, useDictationModel } from "../../hooks/useDictationModel";

const clock = (total: number) =>
  `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;

export function ChatComposer() {
  const {
    setShowSkillsModal,
    setShowHistoryModal,
    stoppingSessions,
    isExecutingPrompt,
    currentSession,
    currentProvider,
    handlePermissionChange,
    handleTriggerHandoff,
    handleStopSession,
    inputMessage,
    setInputMessage,
    attachments,
    fileInputRef,
    handlePaste,
    handleDropFiles,
    handleFileUpload,
    removeAttachment,
    handleSendMessage,
    workspaces,
    setAppError,
  } = useApp();
  const suggestions = useNativeCommands(
    currentProvider?.id,
    currentSession?.cwd,
    inputMessage,
  );
  // @arquivo: arquivos do projeto sugeridos junto do cursor.
  const inputRef = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [mentionPicked, setMentionPicked] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const mention = suggestions.active ? null : mentionAt(inputMessage, caret);
  const projectFiles = useProjectFiles(currentSession?.cwd, mention ? mention.query : null);
  const mentionOpen = !!mention && mentionDismissed !== `${inputMessage}|${caret}`;
  const mentionSelected = Math.min(mentionPicked, Math.max(0, projectFiles.files.length - 1));
  const pickMention = (file: string) => {
    if (!mention) return;
    const next = applyMention(inputMessage, caret, mention.start, file);
    setInputMessage(next.text);
    setCaret(next.caret);
    setMentionPicked(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  // Ditado por voz: o texto entra onde estava o cursor, para revisar antes de enviar.
  const latest = useRef({ inputMessage, caret });
  latest.current = { inputMessage, caret };
  const canDictate = dictationAvailable();
  // Ditado local: o modelo de voz é baixado uma vez, quando o microfone é usado pela primeira vez.
  const speechModel = useDictationModel(setAppError);
  const [offerModel, setOfferModel] = useState(false);
  const dictation = useVoiceDictation({
    onModelMissing: () => {
      setOfferModel(true);
      void speechModel.refresh();
    },
    onText: (spoken) => {
      const { inputMessage: current, caret: at } = latest.current;
      const next = insertDictation(current, at, spoken);
      setInputMessage(next.text);
      setCaret(next.caret);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(next.caret, next.caret);
      });
    },
    onError: setAppError,
    context: () => {
      const cwd = currentSession?.cwd || "";
      const folder = cwd.split(/[\\/]/).filter(Boolean).pop();
      const workspace = workspaces.find((w) => w.path === cwd)?.name;
      const mentioned = latest.current.inputMessage.match(/@[^\s]+/g) || [];
      return [workspace, folder, currentProvider?.name, ...mentioned.map((m) => m.slice(1))].filter(
        (t): t is string => !!t,
      );
    },
  });
  const toggleDictation = async () => {
    if (dictation.state === "recording") return dictation.stop();
    if (dictation.state !== "idle" || speechModel.download) return;
    // Confere na hora: o motor ou o modelo podem ter mudado nas configurações.
    const status = await speechModel.refresh();
    if (status?.engine === "local" && !status.model.installed) setOfferModel(true);
    else void dictation.start();
  };
  const downloadModel = async () => {
    setOfferModel(false);
    if (await speechModel.start()) inputRef.current?.focus();
  };
  // Ctrl+Shift+M liga e desliga o ditado; Esc durante a gravação descarta o áudio.
  const toggleRef = useRef(toggleDictation);
  toggleRef.current = toggleDictation;
  useEffect(() => {
    if (!canDictate) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        void toggleRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canDictate]);
  const { state: dictationState, cancel: cancelDictation } = dictation;
  useEffect(() => {
    if (dictationState !== "recording") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      cancelDictation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dictationState, cancelDictation]);
  const [picked, setPicked] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const open = suggestions.active && dismissed !== inputMessage;
  const selected = Math.min(picked, Math.max(0, suggestions.items.length - 1));
  const complete = (name: string) => {
    // Comando que muda o contexto da sessão: abre o seletor do app, que é quem guarda o estado.
    if (controlForCommand(`/${name}`) && openSessionControl(controlForCommand(`/${name}`)!)) {
      setInputMessage("");
      setPicked(0);
      return;
    }
    setInputMessage(`/${name} `);
    setPicked(0);
  };
  const submit = (event: React.FormEvent) => {
    const control = controlForCommand(inputMessage);
    const known =
      control && suggestions.items.some((c) => `/${c.name}` === inputMessage.trim());
    if (control && known && openSessionControl(control)) {
      event.preventDefault();
      setInputMessage("");
      return;
    }
    handleSendMessage(event);
  };
  return (
                <div className="sticky bottom-0 pt-4 bg-gradient-to-t from-[#fcfbfa] via-[#fcfbfa] to-transparent">
                  {attachments.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2 p-2 bg-[#ffffff] border border-[#ded8cb] rounded-xl shadow-xs">
                      {attachments.map((att) => (
                        <div
                          key={att.id}
                          className="relative group flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg bg-[#f4f1e8] border border-[#e4dec9] text-xs"
                        >
                          {att.type === "image" ? (
                            <img
                              src={att.url}
                              alt={att.name}
                              className="w-7 h-7 object-cover rounded-md"
                            />
                          ) : (
                            <Paperclip size={14} className="text-[#8c8270]" />
                          )}
                          <span className="font-medium text-[#332f28] max-w-[140px] truncate">
                            {att.name}
                          </span>
                          <span className="text-[10px] text-[#8c8270] font-mono">
                            ({att.sizeText})
                          </span>
                          <button
                            type="button"
                            onClick={() => removeAttachment(att.id)}
                            className="p-1 hover:text-rose-600 rounded"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <form
                    onSubmit={submit}
                    onDragOver={(e) => {
                      if (!e.dataTransfer?.types.includes("Files")) return;
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
                    }}
                    onDrop={(e) => {
                      setDragging(false);
                      if (!e.dataTransfer?.files?.length) return;
                      e.preventDefault();
                      handleDropFiles(e.dataTransfer.files);
                    }}
                    className={`relative flex items-center gap-2 bg-[#ffffff] border ${dragging ? "border-amber-500 ring-2 ring-amber-200" : "border-[#dcd6c7]"} focus-within:border-[#968d7a] rounded-2xl p-2 shadow-sm transition`}
                  >
                    {dragging && (
                      <div
                        data-testid="drop-hint"
                        className="absolute inset-0 z-10 rounded-2xl bg-amber-50/90 flex items-center justify-center text-xs font-semibold text-[#8a4b0f] pointer-events-none"
                      >
                        Solte para anexar imagens e arquivos
                      </div>
                    )}
                    {mentionOpen && (
                      <FileSuggestions
                        files={projectFiles.files}
                        selected={mentionSelected}
                        loading={projectFiles.loading}
                        error={projectFiles.error}
                        onPick={pickMention}
                        onHover={setMentionPicked}
                      />
                    )}
                    {open && (
                      <CommandSuggestions
                        items={suggestions.items}
                        selected={selected}
                        loading={suggestions.loading}
                        error={suggestions.error}
                        limitation={suggestions.limitation}
                        onPick={(command) => complete(command.name)}
                        onHover={setPicked}
                      />
                    )}
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      multiple
                      className="hidden"
                      accept="image/*,.pdf,.txt,.ts,.tsx,.json,.md"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2 rounded-xl text-[#7d7565] hover:text-[#221f1a] hover:bg-[#ede9de] transition"
                      title="Anexar arquivos ou prints"
                    >
                      <Paperclip size={17} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowSkillsModal(true)}
                      className="p-2 rounded-xl text-[#7d7565] hover:text-[#1c1b18] hover:bg-[#ede9de] transition"
                      title="Chamar Skills / Revisor (Ctrl+K)"
                    >
                      <Wand2 size={16} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowHistoryModal(true)}
                      className="p-2 rounded-xl text-[#7d7565] hover:text-[#1c1b18] hover:bg-[#ede9de] transition"
                      title="Histórico de conversas passadas (Ctrl+H)"
                    >
                      <Clock size={16} />
                    </button>

                    {speechModel.download && (
                      <div
                        role="status"
                        data-testid="dictation-model-download"
                        className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-xl bg-[#f4f1e8] text-[11px] font-semibold text-[#665e4f]"
                      >
                        <Loader2 size={13} className="animate-spin" />
                        <span>
                          Baixando modelo de voz{" "}
                          {speechModel.download.total
                            ? `${Math.floor((speechModel.download.received / speechModel.download.total) * 100)}%`
                            : "…"}
                        </span>
                        <button
                          type="button"
                          onClick={() => void speechModel.cancel()}
                          aria-label="Cancelar download do modelo de voz"
                          className="p-1 rounded-lg hover:bg-[#eae4d5]"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    )}
                    {offerModel && !speechModel.download && speechModel.status && (
                      <div
                        data-testid="dictation-model-offer"
                        className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-xl bg-[#f4f1e8] text-[11px] font-semibold text-[#443e33]"
                      >
                        <span title="O ditado roda no seu computador: nada de conta, chave ou internet depois do download.">
                          Ditado local precisa do modelo de voz ({formatMegabytes(speechModel.status.model.size)})
                        </span>
                        <button
                          type="button"
                          onClick={() => void downloadModel()}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#1c1b18] text-white hover:bg-[#32302b]"
                        >
                          <Download size={12} />
                          Baixar
                        </button>
                        <button
                          type="button"
                          onClick={() => setOfferModel(false)}
                          aria-label="Agora não"
                          className="p-1 rounded-lg hover:bg-[#eae4d5]"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    )}
                    {canDictate && dictation.state === "idle" && !speechModel.download && !offerModel && (
                      <button
                        type="button"
                        onClick={() => void toggleDictation()}
                        aria-label="Ditar mensagem por voz"
                        className="p-2 rounded-xl text-[#7d7565] hover:text-[#1c1b18] hover:bg-[#ede9de] transition"
                        title="Ditar por voz (Ctrl+Shift+M)"
                      >
                        <Mic size={16} />
                      </button>
                    )}
                    {dictation.state === "recording" && (
                      <div
                        data-testid="dictation-recording"
                        className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-xl bg-rose-50 border border-rose-200 text-rose-800"
                      >
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-600" />
                        </span>
                        <span
                          aria-hidden
                          className="w-10 h-1.5 rounded-full bg-rose-200 overflow-hidden"
                        >
                          <span
                            className="block h-full bg-rose-600 transition-[width] duration-75"
                            style={{ width: `${Math.round(dictation.level * 100)}%` }}
                          />
                        </span>
                        <span className="text-[11px] font-mono font-semibold tabular-nums">
                          {clock(dictation.seconds)}
                        </span>
                        <button
                          type="button"
                          onClick={dictation.stop}
                          aria-label="Concluir ditado e transcrever"
                          title="Concluir e transcrever (Ctrl+Shift+M)"
                          className="p-1 rounded-lg hover:bg-rose-100"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={dictation.cancel}
                          aria-label="Descartar ditado"
                          title="Descartar (Esc)"
                          className="p-1 rounded-lg hover:bg-rose-100"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                    {dictation.state === "transcribing" && (
                      <span
                        role="status"
                        className="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-[#f4f1e8] text-[11px] font-semibold text-[#665e4f]"
                      >
                        <Loader2 size={13} className="animate-spin" />
                        Transcrevendo…
                      </span>
                    )}

                    <input
                      ref={inputRef}
                      type="text"
                      value={inputMessage}
                      role="combobox"
                      aria-expanded={open || mentionOpen}
                      aria-autocomplete="list"
                      onChange={(e) => {
                        setInputMessage(e.target.value);
                        setCaret(e.target.selectionStart ?? e.target.value.length);
                        setPicked(0);
                        setMentionPicked(0);
                      }}
                      onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                      onKeyDown={(e) => {
                        if (mentionOpen) {
                          const count = projectFiles.files.length;
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setMentionDismissed(`${inputMessage}|${caret}`);
                          } else if (count && e.key === "ArrowDown") {
                            e.preventDefault();
                            setMentionPicked((mentionSelected + 1) % count);
                          } else if (count && e.key === "ArrowUp") {
                            e.preventDefault();
                            setMentionPicked((mentionSelected - 1 + count) % count);
                          } else if (count && (e.key === "Tab" || e.key === "Enter")) {
                            e.preventDefault();
                            pickMention(projectFiles.files[mentionSelected]);
                          }
                          return;
                        }
                        if (!open) return;
                        const count = suggestions.items.length;
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setDismissed(inputMessage);
                        } else if (count && e.key === "ArrowDown") {
                          e.preventDefault();
                          setPicked((selected + 1) % count);
                        } else if (count && e.key === "ArrowUp") {
                          e.preventDefault();
                          setPicked((selected - 1 + count) % count);
                        } else if (
                          count &&
                          (e.key === "Tab" ||
                            (e.key === "Enter" &&
                              inputMessage.slice(1).toLowerCase() !==
                                suggestions.items[selected].name.toLowerCase()))
                        ) {
                          // Enter completa o nome; com o nome já completo, envia o comando.
                          e.preventDefault();
                          complete(suggestions.items[selected].name);
                        }
                      }}
                      onPaste={handlePaste}
                      placeholder={`Mensagem para ${currentSession?.currentModel || currentProvider?.name}... (Ctrl+K skills, Ctrl+H histórico)`}
                      className="flex-1 px-2 py-2 text-sm bg-transparent outline-none text-[#1c1b18] placeholder-[#9c9381]"
                    />

                    {currentSession?.permission !== "plan" ? (
                      <button
                        type="button"
                        onClick={() => handlePermissionChange("plan")}
                        className="px-2 py-1 rounded-lg text-[11px] font-semibold text-[#665e4f] bg-[#f4f1e8] hover:bg-[#eae4d5] transition flex items-center gap-1"
                        title="Ativar modo planejamento"
                      >
                        <Compass size={13} className="text-emerald-600" />
                        <span>/plan</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handlePermissionChange("edits")}
                        className="px-2 py-1 rounded-lg text-[11px] font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 transition flex items-center gap-1"
                        title="Voltar para modo de execução normal"
                      >
                        <Zap size={13} className="text-emerald-700" />
                        <span>Plan Ativo</span>
                      </button>
                    )}

                    {!inputMessage && (
                      <button
                        type="button"
                        onClick={handleTriggerHandoff}
                        className="px-2 py-1 rounded-lg text-[11px] font-semibold text-[#665e4f] bg-[#f4f1e8] hover:bg-[#eae4d5] transition flex items-center gap-1"
                        title="Salvar handoff agora"
                      >
                        <ArrowRightLeft size={13} className="text-indigo-600" />
                        <span>/handoff</span>
                      </button>
                    )}

                    {currentSession && isExecutingPrompt && (
                      <button
                        type="button"
                        aria-label="Parar execução e cancelar fila"
                        disabled={!!stoppingSessions[currentSession.id]}
                        onClick={() =>
                          void handleStopSession(currentSession.id)
                        }
                        className="px-3 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-xs font-bold flex gap-1.5 items-center"
                      >
                        <Square size={12} />
                        {stoppingSessions[currentSession.id]
                          ? "Parando…"
                          : "Parar"}
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={!currentSession || !inputMessage.trim()}
                      className="p-2.5 rounded-xl bg-[#1c1b18] hover:bg-[#32302b] disabled:opacity-30 text-white transition"
                    >
                      <Send size={15} />
                    </button>
                  </form>
                </div>
  );
}
