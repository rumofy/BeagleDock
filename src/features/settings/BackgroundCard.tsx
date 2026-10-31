import { beagleApi } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import type { AppSettings } from "../../types";

/** Segundo plano: o app na bandeja e o início junto com o sistema. */
export function BackgroundCard() {
  const { settings, setSettings, setAppError } = useApp();
  const inBackground = settings.runInBackground !== false;
  const atLogin = settings.launchAtLogin === true;

  // Só a chave alterada: o servidor mescla com o resto. Se não puder aplicar (ex.: arquivo de
  // início com o sistema), a interface volta ao valor anterior.
  const save = async (change: Partial<AppSettings>) => {
    const previous = settings;
    setSettings({ ...settings, ...change });
    try {
      const result = await beagleApi.saveAppSettings(change as AppSettings);
      if (!result?.success) throw new Error(result?.error || "Falha ao salvar a preferência.");
    } catch (error) {
      setSettings(previous);
      setAppError((error as Error).message);
    }
  };

  return (
    <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
      <h2 className="font-bold text-lg text-[#1c1b18] mb-1">Segundo plano</h2>
      <p className="text-xs text-[#7d7565] mb-5">
        Com o app na bandeja, as conversas, filas e pedidos de permissão continuam mesmo com a janela fechada. O ícone
        mostra o estado (ocioso, rodando ou aguardando permissão) e o menu lista as conversas em andamento.
      </p>
      <label className="flex items-start gap-3 text-sm text-[#2c2822]">
        <input
          type="checkbox"
          checked={inBackground}
          onChange={(e) => void save({ runInBackground: e.target.checked })}
          className="mt-1"
        />
        <span>
          Manter o BeagleDock na bandeja ao fechar a janela
          <span className="block text-xs text-[#7d7565]">
            Desligado, fechar a janela encerra o app (avisando se houver conversa em execução).
          </span>
        </span>
      </label>
      <label className="mt-3 flex items-start gap-3 text-sm text-[#2c2822]">
        <input
          type="checkbox"
          checked={atLogin}
          onChange={(e) => void save({ launchAtLogin: e.target.checked })}
          className="mt-1"
        />
        <span>
          Iniciar junto com o sistema
          <span className="block text-xs text-[#7d7565]">Abre já na bandeja, sem mostrar a janela. Disponível no Linux.</span>
        </span>
      </label>
    </div>
  );
}
