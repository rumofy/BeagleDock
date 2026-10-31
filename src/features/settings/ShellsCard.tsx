import { beagleApi } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import { AUTO_CLOSE_CHOICES, DEFAULT_AUTO_CLOSE_SECONDS } from "../../lib/shellTabs";
import type { AppSettings } from "../../types";

const label = (seconds: number) =>
  seconds < 60 ? `${seconds} segundos` : seconds === 60 ? "1 minuto" : `${seconds / 60} minutos`;

/** Preferências das abas do shell. */
export function ShellsCard() {
  const { settings, setSettings, setAppError } = useApp();
  const enabled = settings.shellAutoClose !== false;
  const seconds = settings.shellAutoCloseSeconds ?? DEFAULT_AUTO_CLOSE_SECONDS;

  // Só as chaves alteradas: o servidor mescla com o resto das configurações.
  const save = async (change: Partial<AppSettings>) => {
    setSettings({ ...settings, ...change });
    try {
      const result = await beagleApi.saveAppSettings(change as AppSettings);
      if (!result?.success) throw new Error(result?.error || "Falha ao salvar a preferência.");
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  return (
    <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
      <h2 className="font-bold text-lg text-[#1c1b18] mb-1">Shell</h2>
      <p className="text-xs text-[#7d7565] mb-5">
        Cada comando em paralelo tem a própria aba no shell. Fechar uma aba só a esconde: a saída continua em “Tudo”.
      </p>
      <label className="flex items-start gap-3 text-sm text-[#2c2822]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => void save({ shellAutoClose: e.target.checked })}
          className="mt-1"
        />
        <span>
          Fechar sozinha a aba de um comando concluído com sucesso
          <span className="block text-xs text-[#7d7565]">
            Abas com erro, a aba aberta e as que têm saída que você ainda não viu nunca fecham sozinhas.
          </span>
        </span>
      </label>
      <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-[#443e33]">
        Fechar depois de
        <select
          aria-label="Tempo para fechar a aba concluída"
          value={seconds}
          disabled={!enabled}
          onChange={(e) => void save({ shellAutoCloseSeconds: Number(e.target.value) })}
          className="px-2 py-1 rounded-lg border border-[#d6cfbe] bg-[#f4f1e8] text-xs disabled:opacity-40"
        >
          {AUTO_CLOSE_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {label(choice)}
            </option>
          ))}
        </select>
        <span className="font-normal text-[#7d7565]">sem ser vista</span>
      </label>
    </div>
  );
}
