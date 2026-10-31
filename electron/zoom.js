const MIN = 0.7;
const MAX = 1.6;
const STEP = 0.1;

const clamp = (value) =>
  Number.isFinite(value) ? Math.round(Math.min(MAX, Math.max(MIN, value)) * 100) / 100 : 1;

// Atalhos de zoom (Ctrl/Cmd + + / - / 0). Retorna o novo fator ou null se a tecla não é de zoom.
function zoomForKey(input, current) {
  if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return null;
  const key = input.key;
  if (key === "+" || key === "=") return clamp(current + STEP);
  if (key === "-" || key === "_") return clamp(current - STEP);
  if (key === "0") return 1;
  return null;
}

module.exports = { clamp, zoomForKey, MIN, MAX, STEP };
