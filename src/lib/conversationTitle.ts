// Placeholder titles ("New session #3", in any of the app's languages) and greetings or short
// replies that say nothing about the topic: the first real request replaces them.
const generic =
  /^(?:(?:nova sess[aã]o|new session|nueva sesi[oó]n)(?:\s*#\d+)?|conversa|conversation|conversaci[oó]n|(?:oi|ol[aá]|hola|hi|hello|hey|bom dia|boa tarde|boa noite|good (?:morning|afternoon|evening)|buen(?:os|as) (?:d[ií]as|tardes|noches)|e a[ií]|obrigad[oa]|gracias|thanks|thank you|valeu|tenta agora|try again|int[eé]ntalo de nuevo|conseguindo|continua|contin[uú]a|continue|go on|sim|s[ií]|yes|ok)[.!?,\s]*)$/i;
export function conversationTitle(current: string, prompt: string): string {
  if (!generic.test(current.trim())) return current;
  // Commands (/compact, /handoff…) say nothing about what the conversation is about.
  if (prompt.trim().startsWith("/")) return current;
  const topic = prompt
    .replace(/^(?:oi|ol[aá]|hola|hi|hello|hey|bom dia|boa tarde|boa noite|good (?:morning|afternoon|evening)|buen(?:os|as) (?:d[ií]as|tardes|noches))[!,.\s]+/i, "")
    .replace(/^(?:por favor[,\s]+|please[,\s]+|pode\s+|can you\s+|could you\s+|puedes\s+)/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!topic || generic.test(topic)) return current;
  return topic.length > 64 ? topic.slice(0, 61) + "…" : topic;
}
