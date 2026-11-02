import { beagleApi } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import { AUTO_COMPACT_CHOICES, isAutoCompactChosen, resolveAutoCompact } from "../../lib/autoCompact";
import { formatTokens } from "../../lib/tokens";
import type { AppSettings } from "../../types";

/** Compactação automática: mantém o contexto pequeno enquanto o cache de prompt ainda está quente. */
export function AutoCompactCard() {
  const { settings, setSettings, setAppError } = useApp();
  const picked = isAutoCompactChosen(settings.autoCompactTokens)
    ? resolveAutoCompact(settings.autoCompactTokens)
    : null;
  const choices =
    picked === null || AUTO_COMPACT_CHOICES.includes(picked) || picked === 0
      ? AUTO_COMPACT_CHOICES
      : [...AUTO_COMPACT_CHOICES, picked].sort((a, b) => a - b);

  // null volta ao automático (acompanha a janela do modelo).
  const save = async (autoCompactTokens: number | null) => {
    const previous = settings;
    setSettings({ ...settings, autoCompactTokens });
    try {
      const result = await beagleApi.saveAppSettings({ autoCompactTokens } as Partial<AppSettings> as AppSettings);
      if (!result?.success) throw new Error(result?.error || "Falha ao salvar a preferência.");
    } catch (error) {
      setSettings(previous);
      setAppError((error as Error).message);
    }
  };

  return (
    <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
      <h2 className="font-bold text-lg text-[#1c1b18] mb-1">Contexto das conversas</h2>
      <p className="text-xs text-[#7d7565] mb-5">
        Conversas longas e paradas ficam caras: quando o cache de prompt expira, a próxima mensagem reprocessa o contexto
        inteiro e pode gastar boa parte da cota. Compactar cedo mantém esse custo pequeno, mas resume o histórico antigo.
      </p>
      <label className="flex items-center gap-2 text-xs font-semibold text-[#443e33]">
        Compactar sozinho a partir de
        <select
          aria-label="Limite de contexto para compactar sozinho"
          value={picked === null ? "auto" : picked}
          onChange={(e) => void save(e.target.value === "auto" ? null : Number(e.target.value))}
          className="rounded-lg border border-[#d6cfbe] bg-[#faf8f4] px-2 py-1 text-xs"
        >
          <option value="auto">Automático (conforme o modelo)</option>
          <option value={0}>Nunca (desligado)</option>
          {choices.map((tokens) => (
            <option key={tokens} value={tokens}>
              {formatTokens(tokens)} tokens
            </option>
          ))}
        </select>
      </label>
      <p className="mt-3 text-xs text-[#7d7565]">
        No Claude Code e no Codex CLI o limite é aplicado pela própria CLI (vale a partir da próxima mensagem). No
        Antigravity o BeagleDock envia /compact ao fim da resposta quando o contexto passa do limite. No automático o limite é 40% da janela do modelo
        (400 mil numa janela de 1 milhão; 200 mil se a janela for de 200 mil ou ainda desconhecida). Desligado, cada CLI
        segue o comportamento dela.
      </p>
    </div>
  );
}
