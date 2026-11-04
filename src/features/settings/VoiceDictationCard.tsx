import { useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2, Trash2, X } from "lucide-react";
import { beagleApi } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import { formatMegabytes, useDictationModel } from "../../hooks/useDictationModel";
import type { AppSettings, VoiceDictationSettings } from "../../types";

import { t } from "../../i18n";
const DEFAULTS: Required<VoiceDictationSettings> = {
  engine: "local",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-transcribe",
  language: "pt",
  vocabulary: "",
};

const models = () => [
  { id: "gpt-4o-transcribe", label: "gpt-4o-transcribe — " + t("dictationSettings.modelBest") + " (OpenAI)" },
  { id: "gpt-4o-mini-transcribe", label: "gpt-4o-mini-transcribe — " + t("dictationSettings.modelCheaper") + " (OpenAI)" },
  { id: "whisper-large-v3", label: "whisper-large-v3 — Groq" },
];

const languages = () => [
  { id: "pt", label: t("dictationSettings.langPt") },
  { id: "en", label: t("dictationSettings.langEn") },
  { id: "es", label: t("dictationSettings.langEs") },
  { id: "auto", label: t("dictationSettings.langAuto") },
];

const field =
  "w-full px-3.5 py-2.5 rounded-xl border border-[#d6cfbe] bg-[#fcfbfa] text-sm outline-none focus:border-[#968d7a]";
const label = "block text-xs font-bold text-[#443e33] uppercase tracking-wider mb-1.5";
const smallButton =
  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50";

/** Voice dictation in the composer: engine (local or API), voice model and vocabulary. */
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
      if (!result?.success) throw new Error(result?.error || t("dictationSettings.saveFailed"));
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
      <h2 className="font-bold text-lg text-[#1c1b18] mb-1">{t("dictationSettings.title")}</h2>
      <p className="text-xs text-[#7d7565] mb-5">
        {t("dictationSettings.intro")}
      </p>

      <div className="space-y-4">
        <div>
          <label className={label} htmlFor="dictation-engine">
            {t("dictationSettings.engine")}
          </label>
          <select
            id="dictation-engine"
            value={draft.engine}
            onChange={(e) => set({ engine: e.target.value === "api" ? "api" : "local" })}
            className={field}
          >
            <option value="local">{t("dictationSettings.engineLocal")}</option>
            <option value="api">{t("dictationSettings.engineApi")}</option>
          </select>
        </div>

        {draft.engine === "local" ? (
          <div className="rounded-xl border border-[#e4dec9] bg-[#faf8f4] p-4 text-xs text-[#443e33] space-y-3">
            <p>
              {t("dictationSettings.localIntro")}
            </p>
            {speech.status && !speech.status.engineAvailable && (
              <p className="text-rose-700 font-semibold">
                {t("dictationSettings.notBuilt")}
              </p>
            )}
            {model && (
              <div className="flex items-center justify-between gap-3">
                <span data-testid="dictation-model-status">
                  {model.installed ? (
                    <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                      <CheckCircle2 size={14} />
                      {t("dictationSettings.modelInstalled", { size: formatMegabytes(model.size) })}
                    </span>
                  ) : speech.download ? (
                    t("dictationSettings.downloading", { received: formatMegabytes(speech.download.received), total: formatMegabytes(speech.download.total || model.size) })
                  ) : (
                    t("dictationSettings.modelMissing", { size: formatMegabytes(model.size) })
                  )}
                </span>
                {model.installed ? (
                  <button
                    type="button"
                    onClick={() => void speech.remove()}
                    className={`${smallButton} text-[#665e4f] hover:bg-[#eae4d5]`}
                  >
                    <Trash2 size={13} />
                    {t("dictationSettings.deleteModel")}
                  </button>
                ) : speech.download ? (
                  <button
                    type="button"
                    onClick={() => void speech.cancel()}
                    className={`${smallButton} text-[#665e4f] hover:bg-[#eae4d5]`}
                  >
                    <Loader2 size={13} className="animate-spin" />
                    <X size={13} />
                    {t("common.cancel")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void speech.start()}
                    className={`${smallButton} bg-[#1c1b18] text-white hover:bg-[#32302b]`}
                  >
                    <Download size={13} />
                    {t("dictationSettings.downloadModel")}
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
                  {t("header.model")}
                </label>
                <input
                  id="dictation-model"
                  list="dictation-models"
                  value={draft.model}
                  onChange={(e) => set({ model: e.target.value })}
                  className={`${field} font-mono`}
                />
                <datalist id="dictation-models">
                  {models().map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </datalist>
              </div>
              <div>
                <label className={label} htmlFor="dictation-url">
                  {t("dictationSettings.apiUrl")}
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
                  {t("dictationSettings.spokenLanguage")}
                </label>
                <select
                  id="dictation-language"
                  value={draft.language}
                  onChange={(e) => set({ language: e.target.value })}
                  className={field}
                >
                  {languages().map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={label} htmlFor="dictation-key">
                {t("dictationSettings.apiKey")}
              </label>
              <input
                id="dictation-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={keyConfigured ? t("dictationSettings.keyConfigured") : "sk-…"}
                className={`${field} font-mono`}
              />
              <p className="mt-1.5 text-[11px] text-[#7d7565]">
                {t("dictationSettings.keyNote")}
                Para Groq use https://api.groq.com/openai/v1; servidores em localhost dispensam a chave.
              </p>
            </div>
          </>
        )}

        <div>
          <label className={label} htmlFor="dictation-vocabulary">
            {t("dictationSettings.vocabulary")}
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
            {t("dictationSettings.vocabularyHint")}
          </p>
        </div>

        <div className="pt-4 border-t border-[#eeeae0] flex items-center justify-between">
          {saved ? (
            <span className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 size={15} />
              {t("dictationSettings.saved")}
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => void save()}
            className="px-5 py-2.5 rounded-xl bg-[#1c1b18] hover:bg-[#32302b] text-white text-xs font-bold transition"
          >
            {t("dictationSettings.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
