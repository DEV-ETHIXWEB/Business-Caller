"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ThreadMedia } from "@/lib/messageThread";
import { formatClock, pseudoPeaks } from "@/lib/voice";
import { PauseIcon, PlayIcon } from "../icons";

const BARS = 36;
const RATES = [1, 1.5, 2];

// Only one voice note plays at a time, like every chat app.
let activeAudio: HTMLAudioElement | null = null;



function resample(peaks: number[], n: number): number[] {
  if (peaks.length === n) return peaks;
  return Array.from({ length: n }, (_, i) => peaks[Math.min(peaks.length - 1, Math.floor((i / n) * peaks.length))]);
}

export function VoicePlayer({ media, out }: { media: ThreadMedia; out: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(media.seconds ?? 0);
  const [rateIndex, setRateIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const rafRef = useRef<number | null>(null);

  const bars = useMemo(() => resample(media.peaks ?? pseudoPeaks(media.sid), BARS), [media.peaks, media.sid]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (audio && activeAudio === audio) activeAudio = null;
    };
  }, []);

  function tick() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.duration && Number.isFinite(audio.duration)) setProgress(audio.currentTime / audio.duration);
    rafRef.current = requestAnimationFrame(tick);
  }

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    if (activeAudio && activeAudio !== audio) activeAudio.pause();
    activeAudio = audio;
    audio.playbackRate = RATES[rateIndex];
    try {
      await audio.play();
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  function seek(e: React.PointerEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !audio.duration || !Number.isFinite(audio.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
  }

  function cycleRate() {
    const next = (rateIndex + 1) % RATES.length;
    setRateIndex(next);
    if (audioRef.current) audioRef.current.playbackRate = RATES[next];
  }

  const shown = playing || progress > 0 ? (audioRef.current?.currentTime ?? 0) : duration;

  return (
    <div className="flex w-[min(17.5rem,62vw)] items-center gap-2.5 py-0.5" data-testid="voice-player">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void toggle();
        }}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90 ${
          out ? "bg-white/25 text-white" : "bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white shadow-[0_4px_10px_-4px_rgba(192,39,45,0.7)]"
        }`}
      >
        {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
      </button>

      <div className="min-w-0 flex-1">
        <div
          role="slider"
          aria-label="Voice message position"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          tabIndex={0}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={seek}
          onKeyDown={(e) => {
            const audio = audioRef.current;
            if (!audio) return;
            if (e.key === "ArrowRight") audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 3);
            if (e.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 3);
          }}
          className="flex h-8 cursor-pointer touch-none items-center gap-[2px]"
        >
          {bars.map((v, i) => {
            const played = i / BARS < progress;
            return (
              <span
                key={i}
                className={`w-[3px] shrink-0 rounded-full transition-colors ${
                  played ? (out ? "bg-white" : "bg-[#C0272D]") : out ? "bg-white/40" : "bg-slate-300 dark:bg-white/25"
                }`}
                style={{ height: `${Math.max(14, Math.round(v * 100))}%` }}
              />
            );
          })}
        </div>
        <div className={`flex items-center justify-between text-[0.6875rem] leading-none ${out ? "text-white/80" : "text-slate-500 dark:text-slate-400"}`}>
          <span className="tabular-nums">{failed ? "Cannot play" : formatClock(shown)}</span>
          {(playing || rateIndex > 0) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                cycleRate();
              }}
              aria-label={`Playback speed ${RATES[rateIndex]}x`}
              className={`rounded-full px-1.5 py-0.5 font-semibold ${out ? "bg-white/20 text-white" : "bg-slate-900/8 text-slate-600 dark:bg-white/10 dark:text-slate-200"}`}
            >
              {RATES[rateIndex]}x
            </button>
          )}
        </div>
      </div>

      <audio
        ref={audioRef}
        src={media.url}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onPlay={() => {
          setPlaying(true);
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(tick);
        }}
        onPause={() => {
          setPlaying(false);
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
        }}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
        }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
