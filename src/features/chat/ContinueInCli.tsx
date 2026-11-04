import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Split } from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import { providerUsage, suggestContinuation } from "../../lib/continuation";

import { t } from "../../i18n";
const percentLabel = (value: number | null | undefined) =>
  value === null || value === undefined ? t("continue.noReading") : t("continue.used", { percent: Math.round(value) });

/** Header button: continues the task in another CLI, in a new conversation. */
export function ContinueInCliButton() {
  const { providers, currentSession, handleContinueInCli } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const targets = useMemo(
    () => providers.filter((p) => p.installed && p.type === "cli" && p.id !== currentSession?.providerId),
    [providers, currentSession?.providerId],
  );
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!currentSession || !targets.length) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] border border-[#d6cfbe] text-[#332f28] transition shadow-2xs"
        title={t("continue.hint")}
      >
        <Split size={14} className="text-emerald-700" />
        <span>{t("continue.button")}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-30 w-60 rounded-xl border border-[#dcd6c7] bg-white shadow-lg py-1">
          {targets.map((provider) => (
            <button
              key={provider.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void handleContinueInCli(provider.id);
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-[#f4f1e8]"
            >
              <span className="font-semibold text-[#1c1b18]">{provider.name}</span>
              <span className="font-mono text-[10px] text-[#8c8270]">
                {percentLabel(providerUsage(provider))}
              </span>
            </button>
          ))}
          <p className="px-3 pt-1 pb-2 text-[10px] text-[#8c8270] border-t border-[#eee8d9] mt-1">
            {t("continue.menuNote")}
          </p>
        </div>
      )}
    </div>
  );
}

/** Automatic suggestion when the current CLI's quota is nearly used. Informational only; you decide. */
export function ContinuationBanner() {
  const { providers, currentSession, currentProvider, handleContinueInCli, isExecutingPrompt } = useApp();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const suggestion = useMemo(
    () => suggestContinuation(currentProvider, providers),
    [currentProvider, providers],
  );
  if (!suggestion || !currentSession || dismissed === currentSession.id) return null;
  return (
    <div
      role="status"
      data-testid="continuation-banner"
      className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-[#6b3d09]"
    >
      <span className="flex-1 min-w-[200px]">
        {t("continue.banner", { reason: suggestion.reason, name: currentProvider?.name, percent: Math.round(suggestion.percent) })}
      </span>
      {suggestion.targets.map((target) => (
        <button
          key={target.id}
          type="button"
          disabled={isExecutingPrompt}
          onClick={() => void handleContinueInCli(target.id as never)}
          className="px-2.5 py-1 rounded-lg bg-[#1c1b18] hover:bg-[#32302b] disabled:opacity-40 text-white font-bold"
        >
          {target.name}
          {target.percent !== null ? ` (${Math.round(target.percent)}%)` : ""}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setDismissed(currentSession.id)}
        className="px-2 py-1 rounded-lg text-[#6b3d09] hover:bg-amber-100 font-semibold"
      >
        {t("composer.notNow")}
      </button>
    </div>
  );
}
