import React, { useRef, useState } from "react";
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
  const [inputMessage, setInputMessage] = useState("");
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
    attachments,
    fileInputRef,
    handlePaste,
    handleFileUpload,
    removeAttachment,
    handleSendMessage,
  };
}
