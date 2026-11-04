import { useCallback, useEffect, useRef, useState } from "react";
import { beagleApi } from "../../api/beagleApi";
import {
  DICTATION_SAMPLE_RATE,
  encodeWav,
  hasSpeech,
  normalizePeak,
  toBase64,
} from "../../lib/wav";

import { t } from "../../i18n";
export type DictationState = "idle" | "recording" | "transcribing";

/** Longest accepted recording (fits the API's 25 MB limit as 16 kHz WAV). */
const MAX_SECONDS = 10 * 60;

/** Dictation depends on the desktop app's backend (the browser bridge doesn't expose it). */
export const dictationAvailable = (): boolean =>
  typeof window.beagleAPI?.transcribeAudio === "function" &&
  typeof navigator.mediaDevices?.getUserMedia === "function" &&
  typeof MediaRecorder !== "undefined";

function microphoneError(error: unknown): string {
  const name = (error as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return t("dictation.micDenied");
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return t("dictation.noMic");
  if (name === "NotReadableError") return t("dictation.micBusy");
  return t("dictation.micFailed", { error: (error as Error)?.message || String(error) });
}

/** Converts the recording (webm/opus) into 16 kHz mono WAV with normalized volume. */
async function toWav(blob: Blob): Promise<Uint8Array | null> {
  const decoder = new AudioContext();
  try {
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.ceil(decoded.duration * DICTATION_SAMPLE_RATE);
    if (frames <= 0) return null;
    // The mono destination mixes the channels; the OfflineAudioContext resamples.
    const offline = new OfflineAudioContext(1, frames, DICTATION_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const samples = (await offline.startRendering()).getChannelData(0);
    if (!hasSpeech(samples)) return null;
    return encodeWav(normalizePeak(samples), DICTATION_SAMPLE_RATE);
  } finally {
    void decoder.close();
  }
}

/**
 * Voice dictation in the composer: records the microphone, transcribes in the main process and
 * delivers the text to `onText`. `context` holds session terms that help with spelling.
 */
export function useVoiceDictation({
  onText,
  onError,
  onModelMissing,
  context,
}: {
  onText: (text: string) => void;
  onError: (message: string) => void;
  /** The local model hasn't been downloaded yet: the interface offers the download. */
  onModelMissing?: () => void;
  context: () => string[];
}) {
  const [state, setState] = useState<DictationState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const meter = useRef<{ ctx: AudioContext; frame: number } | null>(null);
  const timer = useRef<number | null>(null);
  const discard = useRef(false);
  const callbacks = useRef({ onText, onError, onModelMissing, context });
  callbacks.current = { onText, onError, onModelMissing, context };

  const release = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    if (meter.current) {
      cancelAnimationFrame(meter.current.frame);
      void meter.current.ctx.close();
      meter.current = null;
    }
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setLevel(0);
  }, []);

  const transcribe = useCallback(async (blob: Blob) => {
    setState("transcribing");
    try {
      const wav = await toWav(blob);
      if (!wav) {
        callbacks.current.onError(t("dictation.silence"));
        return;
      }
      const result = await beagleApi.transcribeAudio({
        audio: toBase64(wav),
        context: callbacks.current.context(),
      });
      if (result?.code === "SPEECH_MODEL_MISSING" && callbacks.current.onModelMissing) {
        callbacks.current.onModelMissing();
        return;
      }
      if (!result?.success) throw new Error(result?.error || t("dictation.transcribeFailed"));
      if (result.text) callbacks.current.onText(result.text);
      else callbacks.current.onError(t("dictation.empty"));
    } catch (error) {
      callbacks.current.onError((error as Error).message);
    } finally {
      setState("idle");
    }
  }, []);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const cancel = useCallback(() => {
    discard.current = true;
    stop();
  }, [stop]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      callbacks.current.onError(microphoneError(error));
      return;
    }
    stream.current = media;
    const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    const rec = new MediaRecorder(media, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 128000,
    });
    const chunks: Blob[] = [];
    discard.current = false;
    rec.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    rec.onstop = () => {
      release();
      recorder.current = null;
      if (discard.current || !chunks.length) {
        setState("idle");
        return;
      }
      void transcribe(new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" }));
    };
    recorder.current = rec;
    rec.start(1000);
    setSeconds(0);
    setState("recording");
    const startedAt = Date.now();
    timer.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) stop();
    }, 250);
    // Level meter: shows the microphone is picking up sound.
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(media).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        if (meter.current) meter.current.frame = requestAnimationFrame(tick);
      };
      meter.current = { ctx, frame: requestAnimationFrame(tick) };
    } catch {
      /* the meter is optional */
    }
  }, [release, state, stop, transcribe]);

  // Leaving the screen mid-recording discards the audio and releases the microphone.
  useEffect(
    () => () => {
      discard.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
    },
    [release],
  );

  return { state, seconds, level, start, stop, cancel };
}
