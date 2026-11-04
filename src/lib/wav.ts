/** Sample rate used for dictation: the one transcription models use internally. */
export const DICTATION_SAMPLE_RATE = 16000;

/**
 * Normalizes the volume (peak at ~0.9) without amplifying pure silence: a quiet voice on the
 * microphone becomes a signal the model understands better.
 */
export function normalizePeak(samples: Float32Array, target = 0.9, maxGain = 8): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 1e-4) return samples;
  const gain = Math.min(maxGain, target / peak);
  if (Math.abs(gain - 1) < 0.01) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

/** Whether the recording has anything besides silence (RMS above the noise floor). */
export function hasSpeech(samples: Float32Array, floor = 0.003): boolean {
  if (samples.length === 0) return false;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length) > floor;
}

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** Joins the dictated text to what is already in the field, with a space when needed. */
export function insertDictation(current: string, caret: number, dictated: string) {
  const text = dictated.trim();
  if (!text) return { text: current, caret };
  const at = Math.max(0, Math.min(caret, current.length));
  const before = current.slice(0, at);
  const after = current.slice(at);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const inserted = `${lead}${text}${trail}`;
  return { text: before + inserted + after, caret: at + inserted.length - trail.length };
}

/**
 * Continuous dictation: each part continues at the end of what was already written (not where the
 * caret was), and the caret moves to the end, ready for the next one.
 */
export function appendDictation(current: string, dictated: string) {
  return insertDictation(current, current.length, dictated);
}
