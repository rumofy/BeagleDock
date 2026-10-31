const generic =
  /^(?:nova sess[aã]o(?:\s*#\d+)?|conversa|(?:oi|ol[aá]|bom dia|boa tarde|boa noite|e a[ií]|obrigad[oa]|valeu|tenta agora|conseguindo|continua|sim|ok)[.!?,\s]*)$/i;
export function conversationTitle(current: string, prompt: string): string {
  if (!generic.test(current.trim())) return current;
  const topic = prompt
    .replace(/^(?:oi|ol[aá]|bom dia|boa tarde|boa noite)[!,.\s]+/i, "")
    .replace(/^(?:por favor[,\s]+|pode\s+)/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!topic || generic.test(topic)) return current;
  return topic.length > 64 ? topic.slice(0, 61) + "…" : topic;
}
