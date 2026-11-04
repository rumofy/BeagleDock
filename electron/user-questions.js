// Normalize interactive questions without changing native question IDs or answer text.
function userQuestions(input) {
  if (typeof input === "string") {
    try { input = JSON.parse(input); } catch { return []; }
  }
  if (!Array.isArray(input?.questions)) return [];
  return input.questions.map((q, index) => {
    if (!q || typeof q.question !== "string" || !q.question.trim()) return null;
    return {
      id: typeof q.id === "string" ? q.id : String(index),
      question: q.question,
      header: typeof q.header === "string" ? q.header : "",
      multiSelect: q.multiSelect === true || q.is_multi_select === true,
      options: (Array.isArray(q.options) ? q.options : []).flatMap((o) => {
        const label = typeof o === "string" ? o : o?.label || o?.text;
        return typeof label === "string" && label.trim()
          ? [{ label, description: typeof o?.description === "string" ? o.description : "" }]
          : [];
      }),
    };
  }).filter(Boolean);
}

function validateAnswers(questions, answers) {
  if (!questions.length || !answers || typeof answers !== "object" || Array.isArray(answers)) return null;
  const result = Object.create(null);
  for (const q of questions) {
    const values = Object.hasOwn(answers, q.id) ? answers[q.id] : undefined;
    if (!Array.isArray(values) || !values.length || values.length > (q.multiSelect ? q.options.length + 1 : 1) ||
      values.some((v) => typeof v !== "string" || !v.trim() || v.length > 16000)) return null;
    result[q.id] = [...new Set(values)];
  }
  return result;
}

function claudeAnswers(questions, answers) {
  return Object.fromEntries(questions.map((q) => [q.question, answers[q.id].join(", ")]));
}

module.exports = { userQuestions, validateAnswers, claudeAnswers };
