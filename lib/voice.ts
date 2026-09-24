"use client";

// Voice notes: record from the microphone, then re-encode to a small mono WAV.
// WAV plays on every phone (WebM, which Chrome records, does not play on
// iPhones), and at 12 kHz mono a 40 second note is about 1 MB, which fits the
// size carriers accept for a picture message.

export const MAX_VOICE_SECONDS = 40;
export const VOICE_SAMPLE_RATE = 12000;
const PEAK_BARS = 48;

export interface VoiceRecording {
  wav: Blob;
  seconds: number;
  /** 0..1 loudness per bar, for drawing a waveform. */
  peaks: number[];
}

export interface RecorderHandle {
  /** Stops and returns the finished, encoded recording. */
  stop: () => Promise<VoiceRecording>;
  /** Stops and throws the recording away. */
  cancel: () => void;
}

export class VoiceError extends Error {}

export function voiceSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!(window.AudioContext || (window as typeof window & { webkitAudioContext?: unknown }).webkitAudioContext)
  );
}

function pickMimeType(): string | undefined {
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

function audioContextCtor(): typeof AudioContext {
  return window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
}

// Safari's decodeAudioData only takes callbacks on older versions.
function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const maybe = ctx.decodeAudioData(data, resolve, reject);
    if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
  });
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function computePeaks(samples: Float32Array, bars = PEAK_BARS): number[] {
  const size = Math.max(1, Math.floor(samples.length / bars));
  const peaks: number[] = [];
  for (let b = 0; b < bars; b++) {
    let max = 0;
    for (let i = b * size; i < Math.min(samples.length, (b + 1) * size); i++) max = Math.max(max, Math.abs(samples[i]));
    peaks.push(max);
  }
  const top = Math.max(0.05, ...peaks);
  return peaks.map((p) => Math.min(1, p / top));
}

async function encode(blob: Blob, seconds: number): Promise<VoiceRecording> {
  const AudioCtx = audioContextCtor();
  const ctx = new AudioCtx();
  try {
    const decoded = await decode(ctx, await blob.arrayBuffer());
    const length = Math.max(1, Math.ceil(decoded.duration * VOICE_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, length, VOICE_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    return { wav: encodeWav(samples, VOICE_SAMPLE_RATE), seconds: Math.min(seconds, decoded.duration || seconds), peaks: computePeaks(samples) };
  } catch {
    throw new VoiceError("Could not process the recording. Please try again.");
  } finally {
    void ctx.close().catch(() => {});
  }
}

export async function startRecording(handlers: {
  onTick: (seconds: number) => void;
  /** 0..1 live loudness, for the moving bars. */
  onLevel: (level: number) => void;
  /** Fired once when the time limit is reached (recording keeps its audio). */
  onLimit: () => void;
}): Promise<RecorderHandle> {
  if (!voiceSupported()) throw new VoiceError("Voice notes are not supported in this browser.");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    throw new VoiceError(
      name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone access is blocked. Allow it for this site in your browser settings."
        : "No microphone was found.",
    );
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  const AudioCtx = audioContextCtor();
  const meterCtx = new AudioCtx();
  const analyser = meterCtx.createAnalyser();
  analyser.fftSize = 256;
  meterCtx.createMediaStreamSource(stream).connect(analyser);
  const meterData = new Uint8Array(analyser.frequencyBinCount);

  const startedAt = performance.now();
  let finished = false;
  let limitFired = false;

  const timer = window.setInterval(() => {
    analyser.getByteTimeDomainData(meterData);
    let peak = 0;
    for (const v of meterData) peak = Math.max(peak, Math.abs(v - 128));
    handlers.onLevel(Math.min(1, peak / 90));
    const seconds = (performance.now() - startedAt) / 1000;
    handlers.onTick(Math.min(seconds, MAX_VOICE_SECONDS));
    if (seconds >= MAX_VOICE_SECONDS && !limitFired) {
      limitFired = true;
      handlers.onLimit();
    }
  }, 80);

  function release() {
    finished = true;
    window.clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    void meterCtx.close().catch(() => {});
  }

  recorder.start(250);

  return {
    stop: () =>
      new Promise<VoiceRecording>((resolve, reject) => {
        if (finished) {
          reject(new VoiceError("The recording had already ended."));
          return;
        }
        const seconds = Math.min((performance.now() - startedAt) / 1000, MAX_VOICE_SECONDS);
        recorder.onstop = () => {
          release();
          if (!chunks.length || seconds < 0.4) {
            reject(new VoiceError("That was too short. Hold on a little longer."));
            return;
          }
          encode(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }), seconds).then(resolve, reject);
        };
        if (recorder.state !== "inactive") recorder.stop();
        else recorder.onstop?.(new Event("stop"));
      }),
    cancel: () => {
      if (finished) return;
      recorder.onstop = null;
      recorder.ondataavailable = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // Already stopped.
      }
      release();
    },
  };
}

// Stable, natural-looking bars for a voice note whose real waveform is not
// known (anything received from Twilio): derived from its id so the same note
// always looks the same.
export function pseudoPeaks(seed: string, bars = PEAK_BARS): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const r = (h % 1000) / 1000;
    const envelope = 0.55 + 0.45 * Math.sin((i / bars) * Math.PI);
    out.push(0.22 + 0.78 * r * envelope);
  }
  return out;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(blob);
  });
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
