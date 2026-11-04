const MIN = 0.7;
const MAX = 1.6;
const STEP = 0.1;

const clamp = (value) =>
  Number.isFinite(value) ? Math.round(Math.min(MAX, Math.max(MIN, value)) * 100) / 100 : 1;

// Zoom shortcuts (Ctrl/Cmd + + / - / 0). Returns the new factor, or null if the key isn't a zoom key.
function zoomForKey(input, current) {
  if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return null;
  const key = input.key;
  if (key === "+" || key === "=") return clamp(current + STEP);
  if (key === "-" || key === "_") return clamp(current - STEP);
  if (key === "0") return 1;
  return null;
}

module.exports = { clamp, zoomForKey, MIN, MAX, STEP };
