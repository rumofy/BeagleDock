import { useEffect, useState } from "react";
import { Minus, Monitor, Moon, Plus, Sun } from "lucide-react";
import { backendAvailable, beagleApi } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import { clampZoom, ZOOM_STEP, type ThemeSetting } from "../../lib/theme";

const THEMES: Array<{ id: ThemeSetting; label: string; icon: typeof Sun }> = [
  { id: "cream", label: "Claro", icon: Sun },
  { id: "dark", label: "Escuro", icon: Moon },
  { id: "system", label: "Sistema", icon: Monitor },
];

export function AppearanceCard() {
  const { settings, setSettings, setAppError } = useApp();
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!backendAvailable()) return;
    beagleApi
      .getZoom()
      .then(setZoom)
      .catch(() => {});
  }, []);

  const chooseTheme = async (theme: ThemeSetting) => {
    setSettings({ ...settings, theme });
    try {
      // Só o tema: o servidor mescla com o resto (um zoomFactor antigo no estado não sobrescreve o atual).
      const result = await beagleApi.saveAppSettings({
        theme,
      } as typeof settings);
      if (!result?.success)
        throw new Error(result?.error || "Falha ao salvar o tema.");
    } catch (error) {
      setAppError((error as Error).message);
    }
  };
  const changeZoom = async (factor: number) => {
    try {
      setZoom(await beagleApi.setZoom(clampZoom(factor)));
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  return (
    <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
      <h2 className="font-bold text-lg text-[#1c1b18] mb-1">Aparência</h2>
      <p className="text-xs text-[#7d7565] mb-5">
        Tema e tamanho da interface. O zoom também responde a Ctrl + / Ctrl − /
        Ctrl 0.
      </p>
      <div className="flex flex-wrap items-center gap-6">
        <div role="radiogroup" aria-label="Tema" className="flex gap-2">
          {THEMES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={settings.theme === id}
              onClick={() => chooseTheme(id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition ${
                settings.theme === id
                  ? "bg-[#1c1b18] text-white border-[#1c1b18]"
                  : "bg-[#f4f1e8] text-[#2c2822] border-[#d6cfbe] hover:bg-[#ede9de]"
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2" aria-label="Zoom da interface">
          <button
            type="button"
            onClick={() => changeZoom(zoom - ZOOM_STEP)}
            className="p-2 rounded-xl border border-[#d6cfbe] bg-[#f4f1e8] hover:bg-[#ede9de]"
            aria-label="Diminuir zoom"
          >
            <Minus size={14} />
          </button>
          <span className="w-14 text-center text-xs font-mono">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => changeZoom(zoom + ZOOM_STEP)}
            className="p-2 rounded-xl border border-[#d6cfbe] bg-[#f4f1e8] hover:bg-[#ede9de]"
            aria-label="Aumentar zoom"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            onClick={() => changeZoom(1)}
            className="px-3 py-2 rounded-xl text-xs font-semibold text-[#6d6657] hover:bg-[#ede9de]"
          >
            Redefinir
          </button>
        </div>
      </div>
    </div>
  );
}
