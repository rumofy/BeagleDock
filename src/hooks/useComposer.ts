import React, { useEffect, useRef, useState } from "react";
import { loadDrafts, saveDrafts, updateDraft, type DraftMap } from "../lib/drafts";
import type { ChatAttachment, ChatSession } from "../types";

interface Params {
  currentSession: ChatSession | undefined;
  pendingTurns: React.MutableRefObject<Map<string, number>>;
  setAppError: (message: string) => void;
  handleStopSession: (id: string) => Promise<void>;
  handleTriggerHandoff: () => Promise<void>;
  sendPrompt: (session: ChatSession, promptText: string) => Promise<void>;
}

/** Texto digitado, anexos e envio da mensagem do chat. */
export function useComposer({
  currentSession,
  pendingTurns,
  setAppError,
  handleStopSession,
  handleTriggerHandoff,
  sendPrompt,
}: Params) {
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

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (loadEvent) => {
            const dataUrl = loadEvent.target?.result as string;
            setAttachments((prev) => [
              ...prev,
              {
                id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                name:
                  file.name ||
                  `print-${new Date().toISOString().slice(11, 19)}.png`,
                type: "image",
                url: dataUrl,
                sizeText: `${Math.round(file.size / 1024)} KB`,
              },
            ]);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImg = file.type.startsWith("image/");
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        setAttachments((prev) => [
          ...prev,
          {
            id: `att-${Date.now()}-${i}`,
            name: file.name,
            type: isImg ? "image" : "file",
            url: loadEvent.target?.result as string,
            sizeText: `${Math.round(file.size / 1024)} KB`,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (attId: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  // Envia mensagem no Chat, persiste no SQLite e dispara o processo real da CLI!
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !currentSession) return;
    if (attachments.length) {
      setAppError(
        "Envio de anexos ainda não é suportado neste chat. Informe o caminho do arquivo no projeto.",
      );
      return;
    }
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
    setInputMessage("");
    await sendPrompt(currentSession, promptText);
  };

  return {
    inputMessage,
    setInputMessage,
    draftIds,
    attachments,
    fileInputRef,
    handlePaste,
    handleFileUpload,
    removeAttachment,
    handleSendMessage,
  };
}
