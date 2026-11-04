import { beagleApi, terminalAvailable } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import type { AppSettings } from "../../types";

type Mode = NonNullable<AppSettings["conversationMode"]>;

const OPTIONS: Array<{ id: Mode; label: string; description: string }> = [
  {
    id: "chat",
    label: "Chat do BeagleDock",
    description:
      "Histórico, aprovações com botões, anexos, plano, fila e etapas mostradas no chat. Algumas funções da CLI podem não existir aqui.",
  },
  {
    id: "terminal",
    label: "Terminal da CLI",
    description:
      "Cada conversa abre na interface da própria CLI, continuando a mesma conversa: você digita, anexa e aprova nela, com todos os atalhos. Ficam só o Handoff e o Ditado do BeagleDock. As mensagens trocadas no terminal entram no histórico da conversa ao fim de cada resposta, e o BeagleDock avisa por notificação quando a CLI termina ou espera você.",
  },
];

/** Como as conversas abrem: no chat do BeagleDock ou na interface própria de cada CLI. */
export function ConversationModeCard() {
  const { settings, setSettings, setAppError, hasRunningPrompts } = useApp();
  if (!terminalAvailable()) return null;
  const mode: Mode = settings.conversationMode === "terminal" ? "terminal" : "chat";

  const save = async (conversationMode: Mode) => {
    const previous = settings;
    setSettings({ ...settings, conversationMode });
    try {
      const result = await beagleApi.saveAppSettings({ conversationMode } as Partial<AppSettings> as AppSettings);
      if (!result?.success) throw new Error(result?.error || "Falha ao salvar a preferência.");
    } catch (error) {
      setSettings(previous);
      setAppError((error as Error).message);
    }
  };

  return (
    <div data-testid="conversation-mode" className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
      <h2 className="font-bold text-lg text-[#1c1b18] mb-1">Interface das conversas</h2>
      <p className="text-xs text-[#7d7565] mb-5">
        Vale para o Claude Code, o Codex CLI e o Antigravity. Dá para trocar quando quiser: a conversa continua de onde
        parou.
      </p>
      <div className="space-y-3">
        {OPTIONS.map((option) => (
          <label key={option.id} className="flex items-start gap-3 text-sm text-[#2c2822]">
            <input
              type="radio"
              name="conversation-mode"
              value={option.id}
              checked={mode === option.id}
              disabled={option.id === "terminal" && mode === "chat" && hasRunningPrompts}
              onChange={() => void save(option.id)}
              className="mt-1"
            />
            <span>
              {option.label}
              <span className="block text-xs text-[#7d7565]">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
      {mode === "chat" && hasRunningPrompts && (
        <p className="mt-3 text-xs text-amber-800">Espere as respostas em andamento terminarem para trocar para o terminal.</p>
      )}
    </div>
  );
}
