import { useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2, Trash2, X } from "lucide-react";
import { beagleApi } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import { formatMegabytes, useDictationModel } from "../../hooks/useDictationModel";
import type { AppSettings, VoiceDictationSettings } from "../../types";

const DEFAULTS: Required<VoiceDictationSettings> = {
  engine: "local",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-transcribe",
  language: "pt",
  vocabulary: "",
};

const MODELS = [
  { id: "gpt-4o-transcribe", label: "gpt-4o-transcribe — máxima precisão (OpenAI)" },
  { id: "gpt-4o-mini-transcribe", label: "gpt-4o-mini-transcribe — mais barato (OpenAI)" },
  { id: "whisper-large-v3", label: "whisper-large-v3 — Groq" },
];

const LANGUAGES = [
  { id: "pt", label: "Português" },
  { id: "en", label: "Inglês" },
  { id: "es", label: "Espanhol" },
  { id: "auto", label: "Detectar automaticamente" },
];

const field =
  "w-full px-3.5 py-2.5 rounded-xl border border-[#d6cfbe] bg-[#fcfbfa] text-sm outline-none focus:border-[#968d7a]";
const label = "block text-xs font-bold text-[#443e33] uppercase tracking-wider mb-1.5";
const smallButton =
  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50";

/** Ditado por voz no composer: motor (local ou API), modelo de voz e vocabulário. */
export function VoiceDictationCard() {
  const { settings, setSettings, setAppError } = useApp();
  const [draft, setDraft] = useState<Required<VoiceDictationSettings>>({
    ...DEFAULTS,
    ...settings.voiceDictation,
  });
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const speech = useDictationModel(setAppError);
  useEffect(() => {
    setDraft({ ...DEFAULTS, ...settings.voiceDictation });
  }, [settings.voiceDictation]);
  const set = (patch: Partial<VoiceDictationSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const keyConfigured = !!settings.configuredSecrets?.transcriptionApiKey;
  const model = speech.status?.model;

  const save = async () => {
    try {
      const payload: Partial<AppSettings> = { voiceDictation: draft };
      if (apiKey.trim()) payload.transcriptionApiKey = apiKey.trim();
      const result = await beagleApi.saveAppSettings(payload as AppSettings);
      if (!result?.success) throw new Error(result?.error || "Falha ao salvar o ditado por voz.");
      setSettings((prev) => ({ ...prev, ...result.settings }));
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      void speech.refresh();
    } catch (error) {
      setAppError((error as Error).message);
    }
  };

  return (
    <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
      <h2 className="font-bold text-lg text-[#1c1b18] mb-1">Ditado por voz</h2>
      <p className="text-xs text-[#7d7565] mb-5">
        O botão de microfone no campo de mensagem (ou Ctrl+Shift+M) grava sua fala e escreve o texto no campo para você
        revisar antes de enviar. Vale para Claude Code, Codex CLI e Antigravity.
      </p>

      <div className="space-y-4">
        <div>
          <label className={label} htmlFor="dictation-engine">
            Motor de transcrição
          </label>
          <select
            id="dictation-engine"
            value={draft.engine}
            onChange={(e) => set({ engine: e.target.value === "api" ? "api" : "local" })}
            className={field}
          >
            <option value="local">No computador (Parakeet) — sem conta, sem chave, offline</option>
            <option value="api">API na nuvem (OpenAI ou compatível)</option>
          </select>
        </div>

        {draft.engine === "local" ? (
          <div className="rounded-xl border border-[#e4dec9] bg-[#faf8f4] p-4 text-xs text-[#443e33] space-y-3">
            <p>
              Usa o <strong>Parakeet TDT 0.6B v3</strong> (NVIDIA), que entende português, pontua sozinho e transcreve
              alguns segundos de fala em cerca de 1 s. Ocupa ~800 MB de memória só enquanto transcreve; parado, nada
              fica rodando. O idioma é detectado sozinho.
            </p>
            {speech.status && !speech.status.engineAvailable && (
              <p className="text-rose-700 font-semibold">
                O motor local não foi compilado nesta instalação. Rode <code>npm run build:speech</code> (ou{" "}
                <code>npm run build</code>) e reinstale.
              </p>
            )}
            {model && (
              <div className="flex items-center justify-between gap-3">
                <span data-testid="dictation-model-status">
                  {model.installed ? (
                    <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                      <CheckCircle2 size={14} />
                      Modelo baixado ({formatMegabytes(model.size)})
                    </span>
                  ) : speech.download ? (
                    `Baixando… ${formatMegabytes(speech.download.received)} de ${formatMegabytes(speech.download.total || model.size)}`
                  ) : (
                    `Modelo ainda não baixado (${formatMegabytes(model.size)}, uma vez só)`
                  )}
                </span>
                {model.installed ? (
                  <button
                    type="button"
                    onClick={() => void speech.remove()}
                    className={`${smallButton} text-[#665e4f] hover:bg-[#eae4d5]`}
                  >
                    <Trash2 size={13} />
                    Apagar modelo
                  </button>
                ) : speech.download ? (
                  <button
                    type="button"
                    onClick={() => void speech.cancel()}
                    className={`${smallButton} text-[#665e4f] hover:bg-[#eae4d5]`}
                  >
                    <Loader2 size={13} className="animate-spin" />
                    <X size={13} />
                    Cancelar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void speech.start()}
                    className={`${smallButton} bg-[#1c1b18] text-white hover:bg-[#32302b]`}
                  >
                    <Download size={13} />
                    Baixar modelo
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={label} htmlFor="dictation-model">
                  Modelo
                </label>
                <input
                  id="dictation-model"
                  list="dictation-models"
                  value={draft.model}
                  onChange={(e) => set({ model: e.target.value })}
                  className={`${field} font-mono`}
                />
                <datalist id="dictation-models">
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </datalist>
              </div>
              <div>
                <label className={label} htmlFor="dictation-url">
                  Endereço da API
                </label>
                <input
                  id="dictation-url"
                  value={draft.baseUrl}
                  onChange={(e) => set({ baseUrl: e.target.value })}
                  placeholder={DEFAULTS.baseUrl}
                  className={`${field} font-mono`}
                />
              </div>
              <div>
                <label className={label} htmlFor="dictation-language">
                  Idioma falado
                </label>
                <select
                  id="dictation-language"
                  value={draft.language}
                  onChange={(e) => set({ language: e.target.value })}
                  className={field}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={label} htmlFor="dictation-key">
                Chave da API de transcrição
              </label>
              <input
                id="dictation-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={keyConfigured ? "Chave já cadastrada; digite para substituir" : "sk-…"}
                className={`${field} font-mono`}
              />
              <p className="mt-1.5 text-[11px] text-[#7d7565]">
                Guardada no cofre do sistema. O áudio é enviado para o endereço acima só quando você conclui o ditado.
                Para Groq use https://api.groq.com/openai/v1; servidores em localhost dispensam a chave.
              </p>
            </div>
          </>
        )}

        <div>
          <label className={label} htmlFor="dictation-vocabulary">
            Vocabulário e correções
          </label>
          <textarea
            id="dictation-vocabulary"
            rows={3}
            value={draft.vocabulary}
            onChange={(e) => set({ vocabulary: e.target.value })}
            placeholder={"Rumofy, Supabase, Tailwind\ncloud code => Claude Code"}
            className={`${field} font-mono`}
          />
          <p className="mt-1.5 text-[11px] text-[#7d7565]">
            Um por linha ou separados por vírgula. Um termo sozinho fixa a grafia (“supabase” vira “Supabase”); “errado
            =&gt; certo” troca o que costuma sair errado. Nomes das CLIs, do projeto aberto e de ferramentas
            comuns de desenvolvimento já vêm cadastrados e são reconhecidos mesmo quando saem parecidos
            (“Bigodok” vira “BeagleDock”). Termos que você cadastra com maiúscula, como “Rumofy”, também.
          </p>
        </div>

        <div className="pt-4 border-t border-[#eeeae0] flex items-center justify-between">
          {saved ? (
            <span className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 size={15} />
              Ditado por voz salvo.
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => void save()}
            className="px-5 py-2.5 rounded-xl bg-[#1c1b18] hover:bg-[#32302b] text-white text-xs font-bold transition"
          >
            Salvar ditado por voz
          </button>
        </div>
      </div>
    </div>
  );
}
