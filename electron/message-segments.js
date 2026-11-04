// An AI reply can have several text parts between tools ("I'll run the tests…",
// "passed, now…", the conclusion). So the screen can draw one box per part without changing the saved
// format, the parts are joined by this separator: two line breaks with an invisible
// character (U+2063) between them. Old texts, without the marker, stay as a single box.
// The screen has the same definition in src/lib/messageSegments.ts (a test checks they match).
const SEGMENT_MARK = "⁣";
const SEGMENT_SEPARATOR = `\n\n${SEGMENT_MARK}\n\n`;

// "Clean" text (without the marker), for notifications, titles and any use outside the chat screen.
function plainText(text) {
  return String(text ?? "").split(SEGMENT_SEPARATOR).join("\n\n").split(SEGMENT_MARK).join("");
}

const trimEdges = (text) => text.replace(/^[\s\u2063]+|[\s\u2063]+$/g, "");

// User message delivered mid-turn ("rotation"): what the AI writes after it goes to
// a new reply, below the message, instead of growing the reply that came before. `rotations`
// keeps, in order, where (position in the turn's text) and when each delivery happened.
function addRotation(turn, { responseMessageId, text }) {
  const rotation = {
    responseMessageId,
    start: String(text ?? "").length,
    at: Date.now(),
  };
  if (turn && responseMessageId) (turn.rotations ||= []).push(rotation);
  return rotation;
}
// Where the live text goes: the most recent reply and only the part written after the delivery.
function liveReply(turn, text) {
  const last = turn?.rotations?.at(-1);
  if (!last) return { responseMessageId: turn?.responseMessageId, fullText: text };
  return {
    responseMessageId: last.responseMessageId,
    fullText: String(text ?? "").slice(last.start).replace(/^[\s\u2063]+/, ""),
  };
}
// Final turn result split between the original reply (`output`) and the replies to the
// messages delivered midway (`followUps`).
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
