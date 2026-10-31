import { useEffect, useState } from "react";
import { backendAvailable, beagleApi } from "../../api/beagleApi";
import { Modal } from "../../components/Modal";
import { modelSelection } from "../../lib/modelSelection";
import type { AIProviderId, AIProviderStatus } from "../../types";
import { PaneMessage } from "./PaneMessage";
import type { Sel } from "./useMemoryExplorer";

export function MaintenanceDialog({
  sel,
  providers,
  onClose,
  onStart,
}: {
  sel: Sel;
  providers: AIProviderStatus[];
  onClose: () => void;
  onStart: (args: {
    providerId: AIProviderId;
    model: string;
    effort: string;
    prompt: string;
  }) => Promise<boolean>;
}) {
  const installed = providers.filter((x) => x.installed);
  const [providerId, setProviderId] = useState<AIProviderId | "">(
    installed.find((x) => x.id === "claude")?.id || installed[0]?.id || "",
  );
  const provider = installed.find((x) => x.id === providerId);
  const [model, setModel] = useState(provider?.activeModel || "");
  const [effort, setEffort] = useState("");
  const [mode, setMode] = useState<"plan" | "execute">("plan");
  const [limit, setLimit] = useState(40);
  const [prompt, setPrompt] = useState("");
  const [promptError, setPromptError] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const selection = modelSelection(provider?.modelOptions || [], model, effort);

  useEffect(() => {
    const p = installed.find((x) => x.id === providerId);
    const s = modelSelection(p?.modelOptions || [], p?.activeModel || "", "");
    setModel(s.model);
    setEffort(s.effort);
  }, [providerId]);

  useEffect(() => {
    let alive = true;
    setPromptError("");
    if (!backendAvailable()) return;
    beagleApi
      .getAIMemoryMaintenancePrompt({
        workspace: sel.ws,
        project: sel.p,
        mode,
        maxDeletions: limit,
      })
      .then((text: string) => alive && setPrompt(text))
      .catch((e: Error) => alive && setPromptError(e.message));
    return () => {
      alive = false;
    };
  }, [sel.ws, sel.p, mode, limit]);

  const start = async () => {
    if (!providerId || !prompt) return;
    setStarting(true);
    setError("");
    const ok = await onStart({
      providerId,
      model: selection.model,
      effort: selection.effort,
      prompt,
    });
    setStarting(false);
    if (!ok) setError("Não foi possível iniciar a manutenção. Veja o erro no app.");
  };

  return (
    <Modal title="Manutenção assistida" onClose={onClose} wide>
      <p className="text-xs text-[#6d6657]">
        Uma conversa será aberta para organizar o projeto{" "}
        <b>
          {sel.ws}/{sel.p}
        </b>{" "}
        usando as ferramentas memory_* da CLI escolhida.
      </p>
      {!installed.length ? (
        <PaneMessage tone="error">Nenhuma CLI instalada.</PaneMessage>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span className="font-bold">CLI</span>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value as AIProviderId)}
              className="w-full px-2 py-1.5 rounded-lg border border-[#d6cfbe] bg-white"
            >
              {installed.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-bold">Modelo</span>
            <select
              value={selection.model}
              aria-label="Modelo"
              onChange={(e) => {
                setModel(e.target.value);
                setEffort(
                  modelSelection(
                    provider?.modelOptions || [],
                    e.target.value,
                    selection.effort,
                  ).effort,
                );
              }}
              className="w-full px-2 py-1.5 rounded-lg border border-[#d6cfbe] bg-white"
            >
              <option value="">Padrão da CLI</option>
              {selection.model && !selection.option && (
                <option value={selection.model} disabled>
                  {selection.model} (aguardando catálogo)
                </option>
              )}
              {(provider?.modelOptions || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-bold">Nível</span>
            <select
              value={selection.effort}
              aria-label="Nível de raciocínio"
              onChange={(e) => setEffort(e.target.value)}
              disabled={!selection.option?.efforts.length}
              className="w-full px-2 py-1.5 rounded-lg border border-[#d6cfbe] bg-white"
            >
              {!selection.option?.requiresEffort && (
                <option value="">Padrão da CLI</option>
              )}
              {selection.option?.efforts.map((l) => (
                <option key={l.id} value={l.id} title={l.description}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-bold">Limite de exclusões</span>
            <input
              type="number"
              min={0}
              max={500}
              value={limit}
              onChange={(e) =>
                setLimit(Math.max(0, Math.min(500, Number(e.target.value) || 0)))
              }
              className="w-full px-2 py-1.5 rounded-lg border border-[#d6cfbe] bg-white"
            />
          </label>
          <fieldset className="col-span-2 space-y-1">
            <legend className="font-bold">Modo</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === "plan"}
                onChange={() => setMode("plan")}
              />
              Planejar e aguardar aprovação (recomendado)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === "execute"}
                onChange={() => setMode("execute")}
              />
              Executar com limite
            </label>
          </fieldset>
        </div>
      )}
      <details className="rounded-xl border border-[#e6e1d5] bg-[#faf8f4] text-xs">
        <summary className="cursor-pointer px-3 py-1.5 font-bold text-[#665e4f]">
          Prévia do prompt
        </summary>
        {promptError ? (
          <div className="px-3 pb-2 text-rose-700">{promptError}</div>
        ) : (
          <pre className="px-3 pb-2 whitespace-pre-wrap max-h-60 overflow-auto font-sans">
            {prompt}
          </pre>
        )}
      </details>
      {error && <PaneMessage tone="error">{error}</PaneMessage>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-3 py-2 rounded-lg text-xs font-bold bg-[#ede9de]"
        >
          Cancelar
        </button>
        <button
          disabled={!providerId || !prompt || starting}
          onClick={() => void start()}
          className="px-3 py-2 rounded-lg text-xs font-bold bg-[#1c1b18] text-white disabled:opacity-40"
        >
          {starting ? "Iniciando…" : "Iniciar"}
        </button>
      </div>
    </Modal>
  );
}
