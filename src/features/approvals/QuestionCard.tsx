import { useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import type { CliApproval, QuestionAnswers } from "../../types/api";
import { PROVIDER_NAMES } from "../../lib/approvalLabels";
import { t } from "../../i18n";

export function QuestionCard({ approval, onResolve }: {
  approval: CliApproval;
  onResolve: (id: string, decision: string, message?: string, answers?: QuestionAnswers) => void;
}) {
  const questions = approval.questions || [];
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);
  const answers = Object.fromEntries(questions.map((q) => [q.id, [
    ...(selected[q.id] || []),
    ...(writing[q.id] && custom[q.id]?.trim() ? [custom[q.id].trim()] : []),
  ]]));
  const complete = questions.length > 0 && questions.every((q) => answers[q.id].length > 0);

  return (
    <form
      data-testid="question-card"
      aria-label={t("question.label")}
      className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 shadow-md p-4 space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!complete || sending) return;
        setSending(true);
        try { await onResolve(approval.id, "answer", undefined, answers); }
        finally { setSending(false); }
      }}
    >
      <div className="flex items-center gap-2 text-sm font-bold text-emerald-900">
        <MessageCircleQuestion size={18} className="shrink-0" />
        <span>{t("question.waiting")}</span>
        <span className="text-xs font-medium opacity-80">· {PROVIDER_NAMES[approval.providerId]}</span>
      </div>
      {questions.map((q, index) => (
        <fieldset key={q.id} className="min-w-0 space-y-2.5" disabled={sending}>
          <legend className="w-full mb-2 text-sm font-semibold text-[#2c2822] whitespace-pre-wrap break-words">
            {(q.header || questions.length > 1) && (
              <span className="block mb-1 text-[11px] font-bold text-emerald-800">
                {questions.length > 1 ? `${index + 1}/${questions.length} · ` : ""}{q.header}
              </span>
            )}
            {q.question}
          </legend>
          <p className="text-xs text-emerald-900/70">{t(q.multiSelect ? "question.selectMany" : "question.selectOne")}</p>
          {q.options.map((option, optionIndex) => {
            const checked = (selected[q.id] || []).includes(option.label);
            return (
              <label key={optionIndex} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${checked ? "border-emerald-500 bg-emerald-100" : "border-emerald-200 bg-white/70 hover:bg-emerald-100/50"}`}>
                <input
                  type={q.multiSelect ? "checkbox" : "radio"}
                  name={`${approval.id}-${q.id}`}
                  checked={checked}
                  className="mt-0.5 shrink-0 accent-emerald-700"
                  onChange={() => {
                    setSelected((old) => ({ ...old, [q.id]: q.multiSelect
                      ? checked ? (old[q.id] || []).filter((v) => v !== option.label) : [...(old[q.id] || []), option.label]
                      : [option.label] }));
                    if (!q.multiSelect) setWriting((old) => ({ ...old, [q.id]: false }));
                  }}
                />
                <span className="min-w-0 break-words">
                  <span className="block text-sm font-semibold text-[#2c2822]">{option.label}</span>
                  {option.description && <span className="block mt-1 text-xs text-[#6b6357] whitespace-pre-wrap">{option.description}</span>}
                </span>
              </label>
            );
          })}
          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${writing[q.id] ? "border-emerald-500 bg-emerald-100" : "border-emerald-200 bg-white/70"}`}>
            <input
              type={q.multiSelect ? "checkbox" : "radio"}
              name={`${approval.id}-${q.id}`}
              checked={!!writing[q.id]}
              className="accent-emerald-700"
              onChange={() => {
                setWriting((old) => ({ ...old, [q.id]: !q.multiSelect || !old[q.id] }));
                if (!q.multiSelect) setSelected((old) => ({ ...old, [q.id]: [] }));
              }}
            />
            <span className="text-sm font-semibold text-[#2c2822]">{t("question.other")}</span>
          </label>
          {writing[q.id] && (
            <textarea
              aria-label={t("question.customAnswer")}
              placeholder={t("question.placeholder")}
              value={custom[q.id] || ""}
              onChange={(event) => setCustom((old) => ({ ...old, [q.id]: event.target.value }))}
              rows={3}
              maxLength={16000}
              className="w-full rounded-lg border border-emerald-300 bg-white p-3 text-sm text-[#2c2822] outline-none focus:ring-2 focus:ring-emerald-500"
            />
          )}
        </fieldset>
      ))}
      {!questions.length && <p className="text-sm text-[#2c2822]">{t("question.unavailable")}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={sending} onClick={() => onResolve(approval.id, "deny")}
          className="px-4 py-2 rounded-lg text-xs font-semibold border border-emerald-200 text-emerald-900 hover:bg-emerald-100">
          {t("question.dismiss")}
        </button>
        <button type="submit" disabled={!complete || sending}
          className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed">
          {t("question.submit")}
        </button>
      </div>
    </form>
  );
}
