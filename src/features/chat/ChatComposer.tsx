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
} from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";

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
    handleFileUpload,
    removeAttachment,
    handleSendMessage,
  } = useApp();
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
                    onSubmit={handleSendMessage}
                    className="flex items-center gap-2 bg-[#ffffff] border border-[#dcd6c7] focus-within:border-[#968d7a] rounded-2xl p-2 shadow-sm transition"
                  >
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

                    <input
                      type="text"
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
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
