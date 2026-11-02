import { beagleApi } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import { PROVIDER_NAMES } from "../../lib/approvalLabels";
import { PERMISSION_LABELS } from "../../lib/permissionModes";
import { rememberedChoice } from "../../lib/sessionDefaults";
import type { AppSettings } from "../../types";

/** Chats novos: repetir modelo, nível de raciocínio e permissão da última conversa de cada CLI. */
export function NewChatDefaultsCard() {
  const { settings, setSettings, setAppError, providers } = useApp();
  const enabled = settings.rememberSessionChoices === true;

  const save = async (rememberSessionChoices: boolean) => {
    const previous = settings;
    setSettings({ ...settings, rememberSessionChoices });
    try {
      const result = await beagleApi.saveAppSettings({ rememberSessionChoices } as Partial<AppSettings> as AppSettings);
      if (!result?.success) throw new Error(result?.error || "Falha ao salvar a preferência.");
    } catch (error) {
      setSettings(previous);
      setAppError((error as Error).message);
    }
  };

  // O que o próximo chat de cada CLI vai usar, já validado contra o catálogo atual.
  const rows = providers.map((provider) => {
    const choice = rememberedChoice(true, settings.lastSessionChoices, provider.id, provider.modelOptions || []);
    const option = provider.modelOptions?.find((o) => o.id === choice?.model);
    const effort = option?.efforts.find((e) => e.id === choice?.effort);
    const parts = choice
      ? [
          option?.label || choice.model || "modelo padrão da CLI",
          effort?.label,
          PERMISSION_LABELS[choice.permission],
        ].filter(Boolean)
      : [];
    return { id: provider.id, name: PROVIDER_NAMES[provider.id] || provider.name, summary: parts.join(" · ") };
  });

  return (
    <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
      <h2 className="font-bold text-lg text-[#1c1b18] mb-1">Novos chats</h2>
      <p className="text-xs text-[#7d7565] mb-5">
        Cada conversa guarda o próprio modelo, nível de raciocínio e permissão. Esta opção define com o que um chat novo
        começa.
      </p>
      <label className="flex items-start gap-3 text-sm text-[#2c2822]">
        <input type="checkbox" checked={enabled} onChange={(e) => void save(e.target.checked)} className="mt-1" />
        <span>
          Começar com a última escolha de cada CLI
          <span className="block text-xs text-[#7d7565]">
            Repete o modelo, o nível e a permissão (inclusive o acesso total) escolhidos por último numa conversa da
            mesma CLI. Desligado, o chat novo usa o padrão da CLI.
          </span>
        </span>
      </label>
      {enabled && (
        <ul className="mt-4 space-y-1 text-xs text-[#443e33]">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="font-semibold">{row.name}:</span>{" "}
              {row.summary || <span className="text-[#7d7565]">padrão da CLI até você escolher numa conversa</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
