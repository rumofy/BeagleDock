import React, { useEffect, useRef, useState } from "react";
import { loadDrafts, saveDrafts, updateDraft, type DraftMap } from "../lib/drafts";
import { attachmentProblem, sizeText } from "../lib/attachments";
import { optimizeImage, webpName } from "../lib/imageOptimize";
import { modelSwitch, staleContext } from "../lib/staleContext";
import type { ChatAttachment, ChatSession, ContextInfo } from "../types";

/**
 * Mensagem retida até a pessoa decidir o que fazer numa conversa grande cujo contexto seria
 * reprocessado inteiro: cache expirado (`idleMs`) e/ou modelo trocado (`switched`).
 */
export interface StaleNotice {
  used: number;
  idleMs?: number;
  switched?: { from: string; to: string };
  session: ChatSession;
  text: string;
  attachments: ChatAttachment[];
}

interface Params {
  currentSession: ChatSession | undefined;
  /** Modelo que vai ser enviado na conversa atual, já normalizado pelo catálogo. */
  currentModel: string;
  pendingTurns: React.MutableRefObject<Map<string, number>>;
  setAppError: (message: string) => void;
  handleStopSession: (id: string) => Promise<void>;
  handleTriggerHandoff: () => Promise<void>;
  contextBySession: Record<string, ContextInfo>;
  compactContext: (session: ChatSession) => Promise<void>;
  sendPrompt: (
    session: ChatSession,
    promptText: string,
    attachments?: ChatAttachment[],
  ) => Promise<void>;
}

/** Texto digitado, anexos e envio da mensagem do chat. */
export function useComposer({
  currentSession,
  currentModel,
  pendingTurns,
  setAppError,
  handleStopSession,
  handleTriggerHandoff,
  contextBySession,
  compactContext,
  sendPrompt,
}: Params) {
  const [staleNotice, setStaleNotice] = useState<StaleNotice | null>(null);
  // O hook roda a cada quadro do stream (vive no provedor do app): nada de ler o armazenamento
  // nem interpretar JSON nas renderizações. Carrega uma vez, e grava com atraso.
  const storageRef = useRef<Storage | undefined | null>(null);
  const getStorage = () => {
    if (storageRef.current === null) {
      try {
        storageRef.current = window.localStorage;
      } catch {
        storageRef.current = undefined;
      }
    }
    return storageRef.current;
  };
  const drafts = useRef<DraftMap | null>(null);
  const getDrafts = () => (drafts.current ??= loadDrafts(getStorage()));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushDrafts = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (drafts.current) saveDrafts(drafts.current, getStorage());
  };
  useEffect(() => {
    // Não perde o último trecho digitado ao fechar o app ou esconder a janela.
    const onHide = () => flushDrafts();
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onHide);
      flushDrafts();
    };
  }, []);
  const [draftIds, setDraftIds] = useState<string[]>(() =>
    Object.keys(getDrafts()),
  );
  const sessionId = currentSession?.id || "";
  const [inputMessage, setInputMessageRaw] = useState(
    () => getDrafts()[sessionId] || "",
  );
  const loadedFor = useRef(sessionId);
  const setInputMessage = (value: string) => {
    setInputMessageRaw(value);
    if (!sessionId) return;
    drafts.current = updateDraft(getDrafts(), sessionId, value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushDrafts, 400);
    // A lista de rascunhos só muda quando uma conversa ganha ou perde rascunho.
    const ids = Object.keys(drafts.current);
    setDraftIds((prev) =>
      prev.length === ids.length && prev.every((id, i) => id === ids[i])
        ? prev
        : ids,
    );
  };
  // Ao trocar de conversa, mostra o rascunho dela (o da anterior já foi guardado ao digitar).
  useEffect(() => {
    if (loadedFor.current === sessionId) return;
    loadedFor.current = sessionId;
    setInputMessageRaw(getDrafts()[sessionId] || "");
  }, [sessionId]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentCount = useRef(0);
  attachmentCount.current = attachments.length;

  // Imagens e arquivos entram igual por colar, soltar ou escolher: viram data URL e seguem para a CLI.
  const addFiles = (files: File[]) => {
    let planned = attachmentCount.current;
    for (const file of files) {
      const problem = attachmentProblem(file, planned);
      if (problem) {
        setAppError(problem);
        break;
      }
      planned += 1;
      void readAttachment(file);
    }
  };

  // Imagens passam pela otimização (WebP, no máximo 2576 px no maior lado) antes de virar anexo.
  const readAttachment = async (file: File) => {
    const isImage = file.type.startsWith("image/");
    const baseName =
      file.name ||
      `print-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.png`;
    const optimized = isImage ? await optimizeImage(file) : null;
    const content: Blob = optimized || file;
    const reader = new FileReader();
    reader.onerror = () => setAppError(`Não foi possível ler “${baseName}”.`);
    reader.onload = (loadEvent) => {
      setAttachments((prev) => [
        ...prev,
        {
          id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          name: optimized ? webpName(baseName) : baseName,
          type: isImage ? "image" : "file",
          url: loadEvent.target?.result as string,
          sizeText: sizeText(content.size),
        },
      ]);
    };
    reader.readAsDataURL(content);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  };

  const handleDropFiles = (files: FileList | File[]) => addFiles(Array.from(files));

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(Array.from(e.target.files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (attId: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  // Envia mensagem no Chat, persiste no SQLite e dispara o processo real da CLI!
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !currentSession) return;
    const promptText = inputMessage.trim();
    if (
      (pendingTurns.current.get(currentSession.id) || 0) > 0 &&
      /^(?:\/?(?:para|pare|parar|cancela|cancelar|cancele|cancel|stop|interromper))(?:\s+por favor)?[.!?]*$/i.test(
        promptText,
      )
    ) {
      setInputMessage("");
      await handleStopSession(currentSession.id);
      return;
    }
    if (promptText === "/handoff") {
      setInputMessage("");
      await handleTriggerHandoff();
      return;
    }
    // Conversa grande que seria reprocessada inteira (cache expirado ou modelo trocado): avisa antes
    // de gastar, só quando não há fila nem /compact.
    const check =
      promptText !== "/compact" && !((pendingTurns.current.get(currentSession.id) || 0) > 0);
    const info = contextBySession[currentSession.id];
    const stale = check ? staleContext(info, Date.now()) : null;
    const switched = check ? modelSwitch(info, currentModel) : null;
    if (stale || switched) {
      setStaleNotice({
        used: (stale || switched)!.used,
        ...(stale ? { idleMs: stale.idleMs } : {}),
        ...(switched ? { switched: { from: switched.from, to: switched.to } } : {}),
        session: currentSession,
        text: promptText,
        attachments,
      });
      return;
    }
    const sending = attachments;
    setInputMessage("");
    setAttachments([]);
    await sendPrompt(currentSession, promptText, sending);
  };

  // Decisão sobre a mensagem retida: enviar assim mesmo, compactar antes de enviar, voltar ao modelo
  // anterior (cache ainda quente) ou voltar a editar.
  const resolveStaleNotice = async (choice: "send" | "compact" | "previous" | "cancel") => {
    const notice = staleNotice;
    if (!notice) return;
    setStaleNotice(null);
    if (choice === "cancel") return;
    setInputMessage("");
    setAttachments([]);
    const previous = notice.switched
      ? { ...notice.session, currentModel: notice.switched.from }
      : notice.session;
    if (choice === "previous") {
      await sendPrompt(previous, notice.text, notice.attachments);
      return;
    }
    // Com troca de modelo, compacta no modelo anterior: o novo só lê o resumo.
    if (choice === "compact") await compactContext(previous);
    await sendPrompt(notice.session, notice.text, notice.attachments);
  };

  return {
    inputMessage,
    setInputMessage,
    draftIds,
    attachments,
    fileInputRef,
    handlePaste,
    handleDropFiles,
    handleFileUpload,
    removeAttachment,
    handleSendMessage,
    staleNotice,
    resolveStaleNotice,
  };
}
