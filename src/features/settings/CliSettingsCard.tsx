import {
  Blocks,
  CheckCircle2,
} from "lucide-react";
import { useApp } from "../../hooks/AppStateProvider";
import { beagleApi } from "../../api/beagleApi";
import { CompanyIcon } from "../../components/CompanyIcon";

import { t } from "../../i18n";
export function CliSettingsCard() {
  const {
    updateInfo,
    providers,
    userProfile,
    globalPolicies,
    setGlobalPolicies,
    policyDrafts,
    setPolicyDrafts,
    cliFeedback,
    setCliFeedback,
    cliUpdating,
    setCliUpdating,
    hasRunningPrompts,
  } = useApp();
  return (
                <div className="bg-[#ffffff] border border-[#ded8cb] rounded-2xl p-6 shadow-xs">
                  <div className="flex items-center justify-between pb-4 border-b border-[#eeeae0] mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-[#f4f1e8] text-[#332f28]">
                        <Blocks size={22} />
                      </div>
                      <div>
                        <h2 className="font-bold text-lg text-[#1c1b18]">
                          {t("cliSettings.title")}
                        </h2>
                        <p className="text-xs text-[#7d7565]">
                          {t("cliSettings.subtitle", { name: userProfile.fullName, email: userProfile.email })}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {providers
                      .filter((p) => p.installed)
                      .map((p) => (
                        <div
                          key={p.id}
                          className="p-4 rounded-xl bg-[#fcfbfa] border border-[#ded8cb]"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2.5">
                              <CompanyIcon id={p.id} size={22} />
                              <span className="font-bold text-sm text-[#1c1b18]">
                                {p.name}
                              </span>
                              <span className="text-xs font-mono bg-[#eeeae0] text-[#554e42] px-2 py-0.5 rounded-md">
                                CLI v{p.cliVersion}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-[#8c8270] truncate max-w-xs">
                                {p.cliPath}
                              </span>
                              <button
                                aria-label={t("cliSettings.updateLabel", { name: p.name })}
                                disabled={!!cliUpdating || hasRunningPrompts}
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#ded8cb] disabled:opacity-50"
                                onClick={async () => {
                                  setCliUpdating(p.id);
                                  setCliFeedback((prev) => ({
                                    ...prev,
                                    [p.id]: t("cliSettings.updating"),
                                  }));
                                  try {
                                    const result = await beagleApi.updateCli(p.id);
                                    setCliFeedback((prev) => ({
                                      ...prev,
                                      [p.id]: result.ok
                                        ? result.version ? t("cliSettings.updatedTo", { version: result.version }) : t("cliSettings.updated")
                                        : result.error,
                                    }));
                                  } catch (e) {
                                    setCliFeedback((prev) => ({
                                      ...prev,
                                      [p.id]: (e as Error).message,
                                    }));
                                  } finally {
                                    setCliUpdating("");
                                  }
                                }}
                              >
                                {cliUpdating === p.id
                                  ? t("cliSettings.updating")
                                  : t("cliSettings.update")}
                              </button>
                            </div>
                          </div>

                          {updateInfo.releases?.[p.id]?.version && (
                            <p className="text-xs text-[#7d7565]">
                              {t("cliSettings.latest")}{" "}
                              {updateInfo.releases[p.id].version}
                            </p>
                          )}
                          {cliFeedback[p.id] && (
                            <p
                              role="status"
                              className="text-xs mt-2 text-[#554e42]"
                            >
                              {cliFeedback[p.id]}
                            </p>
                          )}
                          {globalPolicies
                            .filter((policy) => policy.providerId === p.id)
                            .map((policy) => (
                              <div
                                key={p.id}
                                className="mt-3 pt-3 border-t border-[#f0ebd9] space-y-2"
                              >
                                <p className="font-semibold text-xs">
                                  {t("cliSettings.globalPermissions")}
                                </p>
                                <p className="text-[11px] text-[#7d7565]">
                                  {t("cliSettings.globalPermissionsHint")}
                                </p>
                                {policy.error && (
                                  <p
                                    role="alert"
                                    className="text-xs text-rose-700"
                                  >
                                    {policy.error}
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-3 items-end">
                                  {policy.fields.map((field: any) => (
                                    <label
                                      key={field.key}
                                      className="text-xs space-y-1"
                                    >
                                      <span className="block">
                                        {field.label}
                                      </span>
                                      <select
                                        aria-label={t("cliSettings.globalFieldLabel", { name: p.name, field: field.label })}
                                        value={
                                          policyDrafts[p.id]?.[field.key] ??
                                          field.value
                                        }
                                        className="border border-[#ded8cb] rounded-lg p-1.5 bg-white"
                                        onChange={(e) =>
                                          setPolicyDrafts((prev) => ({
                                            ...prev,
                                            [p.id]: {
                                              ...prev[p.id],
                                              [field.key]: e.target.value,
                                            },
                                          }))
                                        }
                                      >
                                        <option value="" disabled>
                                          {t("cliSettings.policyDefault")}
                                        </option>
                                        {field.value &&
                                          !field.values.includes(
                                            field.value,
                                          ) && (
                                            <option
                                              value={field.value}
                                              disabled
                                            >
                                              {field.value}
                                            </option>
                                          )}
                                        {field.values.map((value: string) => (
                                          <option key={value} value={value}>
                                            {field.valueLabels?.[value] ||
                                              value}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ))}
                                  {!!Object.keys(policyDrafts[p.id] || {})
                                    .length && (
                                    <button
                                      className="text-xs border border-[#ded8cb] rounded-lg p-2"
                                      onClick={async () => {
                                        try {
                                          const saved = await beagleApi.saveGlobalPermissions(
                                            p.id,
                                            policyDrafts[p.id],
                                          );
                                          setGlobalPolicies((prev) =>
                                            prev.map((v) =>
                                              v.providerId === p.id ? saved : v,
                                            ),
                                          );
                                          setPolicyDrafts((prev) => ({
                                            ...prev,
                                            [p.id]: {},
                                          }));
                                          setCliFeedback((prev) => ({
                                            ...prev,
                                            [p.id]: t("cliSettings.policySaved"),
                                          }));
                                        } catch (e) {
                                          setCliFeedback((prev) => ({
                                            ...prev,
                                            [p.id]: (e as Error).message,
                                          }));
                                        }
                                      }}
                                    >
                                      {t("cliSettings.policySave")}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          <div className="mt-3 pt-3 border-t border-[#f0ebd9]">
                            <div className="text-[11px] font-bold text-[#8c8270] uppercase tracking-wider mb-2">
                              <span>
                                Servidores MCP Configurados ({p.mcps.length})
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              {p.mcps.map((mcp) => (
                                <div
                                  key={mcp.name}
                                  className="flex items-center justify-between p-2.5 rounded-lg bg-[#ffffff] border border-[#e6e1d5] text-xs"
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    <CheckCircle2
                                      size={13}
                                      className="text-zinc-400 shrink-0"
                                    />
                                    <span className="font-semibold text-[#2e2a24]">
                                      {mcp.name}
                                    </span>
                                    <span className="text-[10px] text-[#8c8270] font-mono">
                                      ({mcp.type})
                                    </span>
                                  </div>
                                  <span className="text-[10px] font-mono bg-[#f4f1e8] text-[#5d5547] px-1.5 py-0.5 rounded">
                                    {mcp.toolsCount || "N/A"} tools
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
  );
}
