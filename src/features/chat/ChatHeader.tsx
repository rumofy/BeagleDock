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
} from "lucide-react";
import { beagleApi } from "../../api/beagleApi";
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

const SOURCE_LABEL = {
  git: "remoto git",
  folder: "nome da pasta",
} as const;

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
        title="Servidor do ai-memory inacessível"
      >
        ai-memory offline
      </span>
    );
  }
  const name = `${scope.workspace}/${scope.project}`;
  const source =
    scope.source === "marker"
      ? `marcador ${scope.markerPath}`
      : SOURCE_LABEL[scope.source];
  const pages = scope.projectExists
    ? `${scope.pages ?? 0} páginas`
    : "projeto ainda não existe no servidor";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Origem: ${source} · ${pages}`}
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
      {scope.projectExists ? "" : " (novo)"}
    </button>
  );
}

export function ChatHeader() {
  const {
    setActiveTab,
    showInlineTerminal,
    setShowInlineTerminal,
    setShowWorkspaceModal,
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
    handleReasoningChange,
    handleTriggerHandoff,
    memoryStatus,
  } = useApp();
  const waitingApproval = cliApprovals.some(
    (a) => a.sessionId === currentSession?.id,
  );
  const { scope: memoryScope } = useAiMemoryScope(
    currentSession?.cwd,
    memoryStatus.serverRunning,
  );
  return (
    <>
      <div className="flex items-center gap-3">
        {currentProvider && (
          <CompanyIcon id={currentProvider.id} size={26} className="shrink-0" />
        )}
        <div>
          <div className="text-sm font-bold text-[#1c1b18] flex items-center gap-2">
            <span>{currentSession?.title || "Selecione uma sessão"}</span>

            {currentProvider && currentSession && (
              <div className="flex items-center gap-1 bg-[#ede9de] rounded-lg px-2 py-0.5 border border-[#dfdacd]">
                <Bot size={13} className="text-[#7d7565]" />
                <select
                  value={currentModelSelection.model}
                  aria-label="Modelo"
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="text-xs font-semibold bg-transparent text-[#2c2822] outline-none cursor-pointer"
                  disabled={isExecutingPrompt}
                  title={
                    currentProvider.modelsError ||
                    currentProvider.modelsSource ||
                    "Usa o modelo padrão da CLI"
                  }
                >
                  <option value="">Padrão da CLI</option>
                  {currentModelSelection.model &&
                    !currentModelSelection.option && (
                      <option value={currentModelSelection.model} disabled>
                        {currentModelSelection.model} (aguardando catálogo)
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

            {currentSession && (
              <div className="flex items-center gap-1 bg-[#ede9de] rounded-lg px-2 py-0.5 border border-[#dfdacd]">
                <Gauge size={13} className="text-[#7d7565]" />
                <select
                  value={currentModelSelection.effort}
                  aria-label="Nível de raciocínio"
                  onChange={(e) =>
                    handleReasoningChange(
                      e.target.value as ReasoningEffortLevel,
                    )
                  }
                  className="text-xs font-semibold bg-transparent text-[#2c2822] outline-none cursor-pointer"
                  disabled={
                    isExecutingPrompt ||
                    !currentModelSelection.option?.efforts.length
                  }
                  title="Níveis informados pela CLI para o modelo selecionado"
                >
                  {!currentModelSelection.option?.requiresEffort && (
                    <option value="">Padrão da CLI</option>
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

            {currentSession && (
              <div
                className={`flex items-center gap-1 rounded-lg px-2 py-0.5 border ${permissionStyle(currentSession.permission || "inherit")}`}
              >
                <ShieldCheck size={13} />
                <select
                  value={currentSession.permission || "inherit"}
                  onChange={(e) =>
                    handlePermissionChange(e.target.value as PermissionLevel)
                  }
                  className="text-xs font-semibold bg-transparent outline-none cursor-pointer"
                  disabled={isExecutingPrompt}
                  title="Permissões da conversa; solicitações elegíveis aparecem no painel de aprovação"
                >
                  <option value="inherit">Global da CLI</option>
                  <option value="plan">🔍 Somente leitura (plano)</option>
                  <option value="ask">🔒 Restrito (nega aprovações)</option>
                  <option value="edits">✏️ Aceitar edições</option>
                  <option value="full">
                    ⚠️ Acesso total (sem confirmação)
                  </option>
                </select>
              </div>
            )}

            {waitingApproval && (
              <span
                role="status"
                data-testid="waiting-permission"
                className="flex items-center gap-1 whitespace-nowrap shrink-0 text-[10px] font-bold text-white bg-amber-600 px-2 py-0.5 rounded-full animate-pulse"
              >
                <ShieldCheck size={10} />
                AGUARDANDO PERMISSÃO
              </span>
            )}
            {isExecutingPrompt ? (
              <span className="flex items-center gap-1 whitespace-nowrap shrink-0 text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                <RefreshCw size={10} className="animate-spin" />
                EXECUTANDO CLI
              </span>
            ) : (
              currentSession?.status === "running" && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  READY
                </span>
              )
            )}
          </div>
          <div className="text-[11px] text-[#7e7565] flex items-center gap-2 mt-0.5">
            <span>
              {currentProvider?.name} (v{currentProvider?.cliVersion})
            </span>
            <span>•</span>

            <div className="flex items-center gap-1.5 bg-[#f4f1e8] hover:bg-[#ede9de] px-2 py-0.5 rounded-md border border-[#dfdacd] transition">
              <FolderGit2 size={12} className="text-[#8c8270]" />
              <select
                value={currentSession?.cwd || ""}
                onChange={(e) => {
                  if (e.target.value === "__add_new__") {
                    setShowWorkspaceModal(true);
                  } else {
                    handleWorkspaceChange(e.target.value);
                  }
                }}
                className="text-[11px] font-mono font-medium bg-transparent text-[#2c2822] outline-none cursor-pointer"
                disabled={
                  !!currentSession?.nativeSessionId || isExecutingPrompt
                }
                title="Após iniciar uma conversa, crie outra sessão para trocar de projeto"
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.path}>
                    {ws.name} ({ws.path})
                  </option>
                ))}
                <option value="__add_new__">
                  + Cadastrar Novo Workspace...
                </option>
              </select>

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

      <div className="flex items-center gap-2.5">
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
                  result?.error || "Não foi possível abrir o VS Code.",
                );
            } catch (error) {
              setAppError((error as Error).message);
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] disabled:opacity-40 border border-[#d6cfbe] text-[#332f28] transition shadow-2xs"
          title="Abrir o projeto desta conversa no VS Code"
        >
          <Code2 size={14} />
          <span>VS Code</span>
        </button>
        <button
          onClick={handleTriggerHandoff}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] border border-[#d6cfbe] text-[#332f28] transition shadow-2xs hover:shadow-xs group"
          title="Sincronizar /handoff real com o ai-memory"
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
            <span className="text-[#8c8270]">| Sem:</span>
            <b
              className={
                getQuotaColor(currentQuota!.weeklyPercent).split(" ")[0]
              }
            >
              {formatQuota(currentQuota!.weeklyPercent)}
            </b>
          </div>
        )}

        <button
          onClick={() => setShowInlineTerminal((prev) => !prev)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
            showInlineTerminal
              ? "bg-[#18181b] text-white shadow-xs"
              : "bg-[#ede9de] hover:bg-[#e2dcce] text-[#36322b]"
          }`}
          title="Exibir ou ocultar o terminal PTY flutuante"
        >
          <Terminal size={14} />
          <span>Shell {showInlineTerminal ? "Visível" : "Oculto"}</span>
        </button>

        <button
          onClick={() => setActiveTab("terminal")}
          className="p-1.5 rounded-xl text-xs font-bold bg-[#ede9de] hover:bg-[#e2dcce] transition text-[#36322b]"
          title="Tela cheia do Terminal PTY"
        >
          <Maximize2 size={14} />
        </button>
      </div>
    </>
  );
}
