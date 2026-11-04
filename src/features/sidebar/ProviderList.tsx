import { useState } from "react";
import { Plus, ChevronDown, ChevronRight } from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import {
  formatQuota,
  formatReset,
  localUtcLabel,
  getQuotaColor,
  providerQuota,
} from "../../lib/format";
import { CompanyIcon } from "../../components/CompanyIcon";
import { SessionRow } from "./SessionRow";
import { useNow } from "../../hooks/useNow";
import { sortByLastUpdate } from "../../lib/sessionOrder";

import { getLocale, t } from "../../i18n";
export function ProviderList() {
  const { providers, handleCreateSession } = useApp();
  // A single clock for the list: the conversations' "cold" badge changes on a scale of minutes.
  const now = useNow(true, 60_000);
  // Quota details (reading, reset, tokens, groups): collapsed by default to leave room for the
  // conversation list; the 5h and weekly percentages stay in the provider header.
  const [showDetails, setShowDetails] = useState<Record<string, boolean>>({});
  const [expandedProviders, setExpandedProviders] = useState<
    Record<string, boolean>
  >({
    claude: true,
    codex: true,
    antigravity: true,
  });

  const toggleExpand = (providerId: string) => {
    setExpandedProviders((prev) => ({
      ...prev,
      [providerId]: !prev[providerId],
    }));
  };

  return (
    <>
      <div className="px-4 py-2 flex items-center justify-between text-[11px] font-bold text-[#8c8270] uppercase tracking-wider">
        <span>{t("sidebar.clisAndQuotas")}</span>
        <span className="text-[10px] text-[#9c9381] font-normal">
          {t("sidebar.usageLegend")}
        </span>
      </div>

      {/* PROVIDERS AND THEIR CONVERSATIONS */}
      <div className="flex-1 overflow-y-auto px-3 space-y-2.5 pb-4">
        {providers.map((provider) => {
          const quota = providerQuota(provider);
          const isExpanded = expandedProviders[provider.id] ?? true;
          // Closed conversations live only in the history (Ctrl+H); most recently updated first.
          const active = sortByLastUpdate(provider.sessions.filter((s) => !s.archived));

          return (
            <div
              key={provider.id}
              className="rounded-xl border border-[#dfdacd]/70 bg-[#f7f5ef]/60 overflow-hidden shadow-2xs"
            >
              <div
                onClick={() => toggleExpand(provider.id)}
                className="p-2.5 flex items-center justify-between cursor-pointer hover:bg-[#eae4d5] transition"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[#8c8270]">
                    {isExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </span>

                  <CompanyIcon
                    id={provider.id}
                    size={20}
                    className="shrink-0"
                  />

                  <div className="truncate">
                    <div className="font-bold text-xs text-[#221f1a] truncate">
                      {provider.name}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="flex items-center gap-1">
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border font-bold ${getQuotaColor(quota.window5hPercent)}`}
                      title={`${quota.sourceLabel || t("quota.noReading")} · ${quota.updatedAt || t("quota.noDate")}${quota.stale ? ` · ${t("quota.outdated")}` : ""}`}
                    >
                      {t("quota.badge5h", { value: formatQuota(quota.window5hPercent) })}
                    </span>

                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border font-bold ${getQuotaColor(quota.weeklyPercent)}`}
                      title={quota.sourceLabel || t("quota.unavailable")}
                    >
                      {t("quota.badgeWeek", { value: formatQuota(quota.weeklyPercent) })}
                    </span>
                  </div>

                  <button
                    onClick={(e) => handleCreateSession(provider.id, e)}
                    className="p-1 hover:bg-[#d6cfbe] rounded text-[#443e33] transition"
                    disabled={!provider.installed}
                    title={
                      provider.installed
                        ? t("sidebar.newConversation")
                        : t("sidebar.cliNotFoundHere")
                    }
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowDetails((prev) => ({
                    ...prev,
                    [provider.id]: !prev[provider.id],
                  }))
                }
                aria-expanded={!!showDetails[provider.id]}
                aria-label={t("quota.detailsOf", { name: provider.name })}
                className="w-full text-left px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8c8270] hover:text-[#443e33]"
              >
                {showDetails[provider.id] ? "▾" : "▸"} {t("quota.details")}
              </button>
              {showDetails[provider.id] && (
                <div data-testid="quota-details">
                  <div
                    className="px-3 pb-2 text-[10px] text-[#7d7565]"
                    title={[quota.groupLabel, quota.sourceLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {quota.groupLabel && (
                      <span className="block">{quota.groupLabel}</span>
                    )}
                    {!provider.installed
                      ? t("sidebar.cliNotFound")
                      : quota.updatedAt
                        ? `${quota.stale ? t("quota.outdatedReading") : t("quota.lastReading")}: ${new Date(quota.updatedAt).toLocaleTimeString(getLocale())}`
                        : t("quota.unavailable")}
                  </div>
                  {provider.installed &&
                    (quota.window5hResetAt || quota.weeklyResetAt) && (
                      <div
                        className="px-3 pb-2 text-[10px] text-[#7d7565]"
                        title={t("quota.resetHint", { zone: localUtcLabel() })}
                      >
                        {t("quota.resets", {
                          five: formatReset(quota.window5hResetAt),
                          week: formatReset(quota.weeklyResetAt),
                          zone: localUtcLabel(),
                        })}
                      </div>
                    )}
                  <div
                    className="px-3 pb-2 text-[10px] text-[#7d7565]"
                    title={[quota.groupLabel, quota.sourceLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {quota.totalTokens == null
                      ? t("quota.tokensUnavailable")
                      : t("quota.tokens7d", { tokens: quota.totalTokens.toLocaleString(getLocale()) })}
                    {provider.id === "antigravity" &&
                    quota.prompts5h !== undefined
                      ? ` · ${t("quota.prompts5h", { count: quota.prompts5h })}`
                      : ""}
                  </div>
                  {quota.groups && quota.groups.length > 0 && (
                    <div
                      className="px-3 pb-2 space-y-1"
                      aria-label={t("quota.agyGroups")}
                    >
                      {quota.groups.map((group) => (
                        <div
                          key={group.name}
                          className="text-[10px] flex justify-between gap-1"
                          title={t("quota.groupResets", { five: group.window5hResetAt || t("quota.notReported"), week: group.weeklyResetAt || t("quota.notReported") })}
                        >
                          <span className="text-[#7d7565] truncate">
                            {group.name}
                          </span>
                          <span className="font-mono whitespace-nowrap">
                            {t("quota.badge5h", { value: formatQuota(group.window5hPercent) })} ·{" "}
                            {t("quota.badgeWeek", { value: formatQuota(group.weeklyPercent) })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {quota.quotaError && (
                <div className="px-3 pb-2 text-[10px] text-amber-800">
                  {quota.quotaError}
                </div>
              )}
              {isExpanded && (
                <div className="py-1 px-1.5 space-y-0.5 border-t border-[#dfdacd]/40">
                  {active.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-[#938b7a] italic">
                      {t("sidebar.noChats")}
                    </div>
                  ) : (
                    active.map((session) => (
                      <SessionRow key={session.id} session={session} now={now} />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
