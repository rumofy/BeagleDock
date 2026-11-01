// Uma resposta da IA pode ter vários trechos de texto entre as ferramentas ("vou rodar os testes…",
// "passou, agora…", a conclusão). Para a tela desenhar uma caixa por trecho sem mudar o formato
// gravado, os trechos são unidos por este separador: duas quebras de linha com um caractere
// invisível (U+2063) no meio. Textos antigos, sem o marcador, seguem como uma caixa só.
// A tela tem a mesma definição em src/lib/messageSegments.ts (um teste confere que são iguais).
const SEGMENT_MARK = "⁣";
const SEGMENT_SEPARATOR = `\n\n${SEGMENT_MARK}\n\n`;

// Texto "limpo" (sem o marcador), para notificações, títulos e qualquer uso fora da tela do chat.
function plainText(text) {
  return String(text ?? "").split(SEGMENT_SEPARATOR).join("\n\n").split(SEGMENT_MARK).join("");
}

const trimEdges = (text) => text.replace(/^[\s\u2063]+|[\s\u2063]+$/g, "");

// Mensagem do usuário entregue no meio do turno ("rotação"): o que a IA escreve depois dela vai para
// uma resposta nova, abaixo da mensagem, em vez de crescer a resposta que veio antes. `rotations`
// guarda, em ordem, onde (posição no texto do turno) e quando cada entrega aconteceu.
function addRotation(turn, { responseMessageId, text }) {
  const rotation = {
    responseMessageId,
    start: String(text ?? "").length,
    at: Date.now(),
  };
  if (turn && responseMessageId) (turn.rotations ||= []).push(rotation);
  return rotation;
}
// Para onde vai o texto ao vivo: a resposta mais recente e só o trecho escrito depois da entrega.
function liveReply(turn, text) {
  const last = turn?.rotations?.at(-1);
  if (!last) return { responseMessageId: turn?.responseMessageId, fullText: text };
  return {
    responseMessageId: last.responseMessageId,
    fullText: String(text ?? "").slice(last.start).replace(/^[\s\u2063]+/, ""),
  };
}
// Resultado final do turno repartido entre a resposta original (`output`) e as respostas das
// mensagens entregues no meio (`followUps`).
function applyRotations(result, turn) {
  const rotations = turn?.rotations;
  if (!rotations?.length) return result;
  const text = typeof result.output === "string" ? result.output : "";
  const aligned = text === turn.text;
  const part = (index) =>
    trimEdges(text.slice(rotations[index].start, rotations[index + 1]?.start));
  return {
    ...result,
    output: aligned ? trimEdges(text.slice(0, rotations[0].start)) : "",
    followUps: rotations.map((rotation, index) => ({
      responseMessageId: rotation.responseMessageId,
      at: rotation.at,
      text: aligned ? part(index) : index === rotations.length - 1 ? text : "",
    })),
  };
}

module.exports = {
  SEGMENT_MARK,
  SEGMENT_SEPARATOR,
  plainText,
  addRotation,
  liveReply,
  applyRotations,
};
