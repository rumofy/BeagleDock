/** Atraso do stream: evento emitido pela CLI → recebido pela interface → aplicado na tela. */
export interface StreamSample {
  ipcMs: number; // emissão no processo principal → chegada no renderer
  frameWaitMs: number; // chegada → início do flush no quadro seguinte
  commitMs: number; // duração do commit do React
  totalMs: number;
}

const MAX_SAMPLES = 500;
const samples: StreamSample[] = [];

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

export function recordStreamSample(sample: Omit<StreamSample, "totalMs">) {
  const total = sample.ipcMs + sample.frameWaitMs + sample.commitMs;
  if (!Number.isFinite(total) || total < 0) return;
  samples.push({ ...sample, totalMs: total });
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export function getStreamStats() {
  const totals = samples.map((s) => s.totalMs);
  return {
    count: samples.length,
    p50: percentile(totals, 50),
    p95: percentile(totals, 95),
    max: totals.length ? Math.max(...totals) : null,
    ipcP95: percentile(samples.map((s) => s.ipcMs), 95),
    commitP95: percentile(samples.map((s) => s.commitMs), 95),
  };
}

export function resetStreamStats() {
  samples.length = 0;
}
