import {
  Terminal,
  Maximize2,
  ArrowRightLeft,
  Bot,
  Gauge,
  FolderGit2,
  RefreshCw,
  ShieldCheck,
  Code2,
  Settings2,
  X,
} from "lucide-react";
import { beagleApi, editorAvailable, shellAvailable, workspaceEditingAvailable } from "../../api/beagleApi";
import { useApp } from "../../hooks/AppStateProvider";
import { formatQuota, getQuotaColor, permissionStyle } from "../../lib/format";
import { CompanyIcon } from "../../components/CompanyIcon";
import { useAiMemoryScope } from "./useAiMemoryScope";
import { writeLast } from "../memory/useMemoryExplorer";
import type {
  AIMemoryScope,
  ReasoningEffortLevel,
  PermissionLevel,
} from "../../types";
import { ContinueInCliButton } from "./ContinueInCli";
import { handoffPrompt } from "../../lib/handoffPrompt";
import { backgroundLabel, backgroundWork } from "../../lib/backgroundWork";
import { TerminalDictationButton } from "../terminal/TerminalDictationButton";

import { t, tn } from "../../i18n";
const sourceLabel = (source: "git" | "folder") =>
  source === "git" ? t("memoryScope.sourceGit") : t("memoryScope.sourceFolder");

function AiMemoryBadge({
  scope,
  onOpen,
}: {
  scope: AIMemoryScope | null;
  onOpen: () => void;
}) {
  const base =
    "flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.2 rounded";
  if (!scope || !scope.serverOnline) {
    return (
      <span
        className={`${base} font-medium text-[#8c8270] bg-[#e8e2d4]`}
        title={t("memoryScope.offlineHint")}
      >
        ai-memory offline
      </span>
    );
  }
  const name = `${scope.workspace}/${scope.project}`;
  const source =
    scope.source === "marker"
      ? t("memoryScope.sourceMarker", { path: scope.markerPath })
      : sourceLabel(scope.source);
  const pages = scope.projectExists
    ? tn("memoryScope.pages", scope.pages ?? 0)
    : t("memoryScope.projectMissing");
  return (
    <button
      type="button"
      onClick={onOpen}
      title={t("memoryScope.hint", { source, pages })}
      className={`${base} ${
        scope.projectExists
          ? "text-emerald-800 bg-emerald-100/90"
          : "text-amber-800 bg-amber-100/90"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          scope.projectExists ? "bg-emerald-600" : "bg-amber-500"
        }`}
      />
      ai-memory · {name}
      {scope.projectExists ? "" : ` ${t("memoryScope.new")}`}
    </button>
  );
}

export function ChatHeader() {
  const {
    setActiveTab,
    showInlineTerminal,
    setShowInlineTerminal,
    setShowWorkspaceModal,
    setShowWorkspaceManager,
    workspaces,
    isExecutingPrompt,
    setAppError,
    cliApprovals,
    currentSession,
    currentProvider,
    currentQuota,
    currentModelSelection,
    handleWorkspaceChange,
    handleModelChange,
    handlePermissionChange,
    permissionNotice,
    handleReasoningChange,
    handleTriggerHandoff,
    memoryStatus,
    cliTerminals,
    isChangingWorkspace,
    currentMessages,
    setSessionArchived,
  } = useApp();
  const background = backgroundWork(currentMessages);
  // Terminal mode: the CLI handles model, plan, permissions and approvals; the header only keeps
  // what belongs to BeagleDock (project, VS Code, handoff, dictation and quota).
  const terminalMode = cliTerminals.isTerminal(currentSession?.id);
  const terminalState = currentSession ? cliTerminals.terminals[currentSession.id] : undefined;
  const terminalStarted = !!currentSession && (!!currentSession.nativeSessionId || !!currentSession.cwdLocked || cliTerminals.hasStarted(currentSession.id));
  const terminalOpening = cliTerminals.isOpening(currentSession?.id);
  const waitingApproval = cliApprovals.some(
    (a) => a.sessionId === currentSession?.id,
  );
  const waitingQuestionOnly = waitingApproval && cliApprovals.filter((a) => a.sessionId === currentSession?.id).every((a) => a.kind === "question");
  const waitingPlanOnly =
    waitingApproval &&
    cliApprovals
      .filter((a) => a.sessionId === currentSession?.id)
      .every((a) => a.kind === "plan");
  const { scope: memoryScope } = useAiMemoryScope(
    currentSession?.cwd,
    memoryStatus.serverRunning,
  );
  return (
    <>
      <div className="flex items-center gap-3 min-w-0">
        {currentProvider && (
          <CompanyIcon id={currentProvider.id} size={26} className="shrink-0" />
        )}
        <div className="min-w-0">
          <div className="text-sm font-bold text-[#1c1b18] flex flex-wrap items-center gap-2">
            <span
              className="max-w-[26rem] truncate"
              title={currentSession?.title || undefined}
            >
              {currentSession?.title || t("header.selectSession")}
            </span>

            {currentProvider && currentSession && !terminalMode && (
              <div className="flex items-center gap-1 bg-[#ede9de] rounded-lg px-2 py-0.5 border border-[#dfdacd]">
                <Bot size={13} className="text-[#7d7565]" />
                <select
                  value={currentModelSelection.model}
                  aria-label={t("header.model")}
                  data-control="model"
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="text-xs font-semibold bg-[#ede9de] text-[#2c2822] outline-none cursor-pointer"
                  disabled={isExecutingPrompt}
                  title={
                    currentProvider.modelsError ||
                    currentProvider.modelsSource ||
                    t("header.modelDefaultHint")
                  }
                >
                  <option value="">{t("header.cliDefault")}</option>
                  {currentModelSelection.model &&
                    !currentModelSelection.option && (
                      <option value={currentModelSelection.model} disabled>
                        {t("header.modelWaitingCatalog", { model: currentModelSelection.model })}
                      </option>
                    )}
                  {(currentProvider.modelOptions || []).map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {currentSession && !terminalMode && (
              <div className="flex items-center gap-1 bg-[#ede9de] rounded-lg px-2 py-0.5 border border-[#dfdacd]">
                <Gauge size={13} className="text-[#7d7565]" />
                <select
                  value={currentModelSelection.effort}
                  aria-label={t("header.effort")}
                  data-control="effort"
                  onChange={(e) =>
                    handleReasoningChange(
                      e.target.value as ReasoningEffortLevel,
                    )
                  }
                  className="text-xs font-semibold bg-[#ede9de] text-[#2c2822] outline-none cursor-pointer"
                  disabled={
                    isExecutingPrompt ||
                    !currentModelSelection.option?.efforts.length
                  }
                  title={t("header.effortHint")}
                >
                  {!currentModelSelection.option?.requiresEffort && (
                    <option value="">{t("header.cliDefault")}</option>
                  )}
                  {currentModelSelection.option?.efforts.map((level) => (
                    <option
                      key={level.id}
                      value={level.id}
                      title={level.description}
                    >
                      {level.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {currentSession && !terminalMode && (
              <div
                className={`flex items-center gap-1 rounded-lg px-2 py-0.5 border ${permissionStyle(currentSession.permission || "inherit")}`}
              >
                <ShieldCheck size={13} />
                <select
                  data-control="permission"
                  value={currentSession.permission || "inherit"}
                  onChange={(e) =>
                    handlePermissionChange(e.target.value as PermissionLevel)
                  }
                  className="text-xs font-semibold bg-inherit outline-none cursor-pointer"
                  title={t("header.permissionHint")}
                >
                  <option value="inherit">{t("permission.inherit")}</option>
                  <option value="plan">🔍 {t("permission.plan")}</option>
                  <option value="ask">🔒 {t("header.permissionAsk")}</option>
                  <option value="edits">✏️ {t("permission.edits")}</option>
                  <option value="full">
                    ⚠️ {t("header.permissionFull")}
                  </option>
                </select>
              </div>
            )}

            {!terminalMode && permissionNotice?.sessionId === currentSession?.id && (
              <span
                role="status"
                data-testid="permission-notice"
                className="text-[10px] text-[#665e4f] max-w-xs leading-tight"
              >
                {permissionNotice?.text}
              </span>
            )}
            {!terminalMode && waitingApproval && (
              <span
                role="status"
                data-testid="waiting-permission"
                className="flex items-center gap-1 whitespace-nowrap shrink-0 text-[10px] font-bold text-white bg-amber-600 px-2 py-0.5 rounded-full animate-pulse"
              >
                <ShieldCheck size={10} />
                {waitingQuestionOnly ? t("question.waiting") : waitingPlanOnly ? t("header.planToReview") : t("header.waitingPermission")}
              </span>
            )}
            {terminalMode ? (
              <span data-testid="terminal-status" className="flex items-center gap-1 whitespace-nowrap shrink-0 text-[10px] font-bold text-zinc-100 bg-[#27272a] px-2 py-0.5 rounded-full">
                <span className={`w-1.5 h-1.5 rounded-full ${terminalState?.status === "running" ? "bg-emerald-500 animate-pulse" : terminalState?.status === "waiting_input" ? "bg-amber-500" : "bg-zinc-400"}`} />
                {t(terminalOpening ? "terminal.starting" : !terminalStarted ? "terminal.notStarted" : terminalState?.status === "running" ? "session.running" : terminalState?.status === "waiting_input" ? "terminal.waitingInput" : "session.idle")}
              </span>
            ) : isExecutingPrompt ? (
              <span className="flex items-center gap-1 whitespace-nowrap shrink-0 text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                <RefreshCw size={10} className="animate-spin" />
                {t("header.runningCli")}
              </span>
            ) : background.total > 0 ? (
              <span
                role="status"
                data-testid="header-background"
                title={t("header.backgroundHint")}
                className="flex items-center gap-1 whitespace-nowrap shrink-0 text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                {backgroundLabel(background).toUpperCase()}
              </span>
            ) : (
              currentSession?.status === "running" && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  READY
                </span>
              )
            )}
          </div>
          <div className="text-[11px] text-[#7e7565] flex flex-wrap items-center gap-2 mt-0.5">
            <span>
              {currentProvider?.name} (v{currentProvider?.cliVersion})
            </span>
            <span>•</span>

            <div className="flex items-center gap-1.5 bg-[#f4f1e8] hover:bg-[#ede9de] px-2 py-0.5 rounded-md border border-[#dfdacd] transition">
              <FolderGit2 size={12} className="text-[#8c8270]" />
              <select
                data-testid="conversation-workspace"
                value={currentSession?.cwd || ""}
                onChange={(e) => {
                  if (e.target.value === "__add_new__") {
                    setShowWorkspaceModal(true);
                  } else {
                    handleWorkspaceChange(e.target.value);
                  }
                }}
                className="max-w-[55vw] sm:max-w-none truncate text-[11px] font-mono font-medium bg-[#f4f1e8] hover:bg-[#ede9de] text-[#2c2822] outline-none cursor-pointer"
                disabled={
                  !!currentSession?.nativeSessionId || !!currentSession?.cwdLocked || isExecutingPrompt || cliTerminals.hasStarted(currentSession?.id) || terminalOpening || isChangingWorkspace
                }
                title={t(terminalMode && !terminalStarted ? "terminal.chooseWorkspace" : "header.workspaceLocked")}
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.path}>
                    {ws.name} ({ws.path})
                  </option>
                ))}
                {workspaceEditingAvailable() && (
                <option value="__add_new__">
                  + Cadastrar Novo Workspace...
                </option>
                )}
              </select>
              {workspaceEditingAvailable() && (
              <button
                type="button"
                onClick={() => setShowWorkspaceManager(true)}
                title={t("header.manageWorkspaces")}
                aria-label={t("header.manageWorkspaces")}
                className="p-0.5 rounded text-[#8c8270] hover:text-[#2c2822] hover:bg-[#e6e0d0]"
              >
                <Settings2 size={12} />
              </button>
              )}

              <AiMemoryBadge
                scope={memoryScope}
                onOpen={() => {
                  if (memoryScope?.projectExists)
                    writeLast(
                      `${memoryScope.workspace}/${memoryScope.project}`,
                    );
                  setActiveTab("memory");
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2.5 [&_button]:whitespace-nowrap">
        {editorAvailable() && (
        <button
          type="button"
          disabled={!currentSession}
          onClick={async () => {
            if (!currentSession) return;
            try {
              const result = await beagleApi.openInEditor({
                cwd: currentSession.cwd,
              });
              if (!result?.ok)
                setAppError(
                  result?.error || t("header.vsCodeFailed"),
                );
            } catch (error) {
              setAppError((error as Error).message);
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] disabled:opacity-40 border border-[#d6cfbe] text-[#332f28] transition shadow-2xs"
          title={t("header.vsCodeHint")}
        >
          <Code2 size={14} />
          <span>VS Code</span>
        </button>
        )}
        {!terminalMode && <ContinueInCliButton />}
        {terminalMode && !terminalStarted && !terminalOpening && currentSession && (
          <button type="button" data-testid="start-cli" disabled={isChangingWorkspace}
            onClick={() => cliTerminals.startTerminal(currentSession.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#1c1b18] text-white disabled:opacity-40">
            <Terminal size={14} />{t("terminal.start")}
          </button>
        )}
        {terminalMode && terminalStarted && <TerminalDictationButton />}
        <button
          disabled={terminalMode && !terminalStarted}
          onClick={() => {
            if (!currentSession) return;
            // In the terminal the request is pasted and sent in the CLI itself (any queue is the CLI's own).
            if (terminalMode) void cliTerminals.pasteToTerminal(currentSession.id, handoffPrompt(), true);
            else void handleTriggerHandoff();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] border border-[#d6cfbe] text-[#332f28] transition shadow-2xs hover:shadow-xs group"
          title={t("header.handoffHint")}
        >
          <ArrowRightLeft
            size={14}
            className="text-indigo-600 group-hover:rotate-180 transition-transform duration-300"
          />
          <span>Handoff</span>
        </button>

        {currentProvider && (
          <div className="flex items-center gap-2 text-xs font-mono bg-[#f4f1e8] px-2.5 py-1 rounded-xl border border-[#e6e0d2]">
            <span className="text-[#8c8270]">5h:</span>
            <b
              className={
                getQuotaColor(currentQuota!.window5hPercent).split(" ")[0]
              }
            >
              {formatQuota(currentQuota!.window5hPercent)}
            </b>
            <span className="text-[#8c8270]">| {t("header.weekShort")}:</span>
            <b
              className={
                getQuotaColor(currentQuota!.weeklyPercent).split(" ")[0]
              }
            >
              {formatQuota(currentQuota!.weeklyPercent)}
            </b>
          </div>
        )}

        {!terminalMode && shellAvailable() && (
        <>
        <button
          onClick={() => setShowInlineTerminal((prev) => !prev)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
            showInlineTerminal
              ? "bg-[#1c1b18] text-white shadow-xs"
              : "bg-[#ede9de] hover:bg-[#e2dcce] text-[#36322b]"
          }`}
          title={t("header.shellToggleHint")}
        >
          <Terminal size={14} />
          <span>{showInlineTerminal ? t("header.shellVisible") : t("header.shellHidden")}</span>
        </button>

        <button
          onClick={() => setActiveTab("terminal")}
          className="p-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] transition text-[#36322b]"
          title={t("header.shellFullscreen")}
        >
          <Maximize2 size={14} />
        </button>
        </>
        )}

        {currentSession && (
          <button
            type="button"
            data-testid="close-conversation"
            onClick={() => void setSessionArchived(currentSession.id, true)}
            className="p-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white transition shadow-2xs"
            title={t("session.closeHint")}
            aria-label={t("session.closeLabel")}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </>
  );
}
