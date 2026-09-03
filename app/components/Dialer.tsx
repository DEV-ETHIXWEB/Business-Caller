"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { Call, Device } from "@twilio/voice-sdk";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";

// The number clients will see on their caller ID. This is display-only;
// the number actually used to place the call is TWILIO_PHONE_NUMBER on the
// server (app/api/voice/route.ts). Keep these in sync if the number ever
// changes.
const DISPLAY_CALLER_ID = "+1 (206) 452-3433";

const STORAGE_KEY = "dialer_access_code";

const KEYPAD_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

type CallStatus = "ready" | "connecting" | "ringing" | "in-call" | "wrapping-up";
type MicPermission = "checking" | "granted" | "denied";

interface DeviceErrorLike {
  code?: number;
  message?: string;
}

function friendlyError(error: DeviceErrorLike): string {
  switch (error.code) {
    case 20101:
    case 20104:
      return "Your session expired. Please sign out and enter the access code again.";
    case 31005:
    case 31009:
      return "Lost connection to Twilio. Check your internet connection and try again.";
    case 31201:
    case 31208:
      return "Microphone access was blocked by the browser.";
    case 31402:
      return "The call could not be placed. The number may be invalid or unreachable.";
    default:
      return error.message || "Something went wrong with the call. Please try again.";
  }
}

function Logo() {
  return (
    <Image
      src="/ethixweb-logo.png"
      alt="Ethixweb"
      width={400}
      height={60}
      priority
      className="mx-auto h-6 w-auto dark:invert"
    />
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
    </svg>
  );
}

function MicOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 9v2a3 3 0 0 0 5.12 2.12M12 2a3 3 0 0 1 3 3v4c0 .3-.03.6-.08.88M5 10a7 7 0 0 0 9.5 6.6M19 10a7 7 0 0 1-.34 2.17" />
      <path d="M12 19v3" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

function SpeakerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M11 5 6 9H3v6h3l5 4Z" />
      <path d="M16 8a5 5 0 0 1 0 8" />
      <path d="M19 5a9 9 0 0 1 0 14" />
    </svg>
  );
}

function KeypadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      {[5, 12, 19].flatMap((cy) => [5, 12, 19].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" />))}
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-gradient-to-br from-[#F7F2F1] via-white to-[#F5EFEE] px-4 py-8 dark:from-[#0c0d10] dark:via-[#120a0b] dark:to-black">
      <div className="pointer-events-none absolute -left-24 -top-32 h-96 w-96 rounded-full bg-[#C0272D]/20 blur-[120px] dark:bg-[#C0272D]/25" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-[#C0272D]/10 blur-[120px] dark:bg-[#C0272D]/10" />
      <div className="pointer-events-none absolute right-10 top-10 h-56 w-56 rounded-full bg-slate-400/10 blur-[100px] dark:bg-white/5" />
      {children}
    </div>
  );
}

const CARD_CLASS =
  "relative w-full max-w-sm rounded-[2rem] border border-white/70 bg-white/70 p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_25px_70px_-20px_rgba(192,39,45,0.15),0_15px_35px_-15px_rgba(15,23,42,0.2)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_25px_70px_-15px_rgba(192,39,45,0.25),0_20px_60px_-20px_rgba(0,0,0,0.8)]";

const INPUT_CLASS =
  "mt-1 w-full rounded-2xl border border-white/70 bg-white/60 px-4 py-2.5 text-slate-900 shadow-[inset_0_2px_6px_rgba(15,23,42,0.08)] outline-none backdrop-blur-sm transition placeholder:text-slate-400 focus:border-[#C0272D]/40 focus:bg-white/90 focus:ring-4 focus:ring-[#C0272D]/15 disabled:bg-slate-100/50 disabled:text-slate-400 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:shadow-[inset_0_2px_6px_rgba(0,0,0,0.4)] dark:placeholder:text-slate-500 dark:focus:bg-white/10 dark:focus:ring-[#C0272D]/20 dark:disabled:bg-white/[0.02] dark:disabled:text-slate-600";

const SELECT_CLASS =
  "w-full appearance-none rounded-xl border border-white/70 bg-white/60 py-2 pl-8 pr-7 text-[11px] font-medium text-slate-700 shadow-[inset_0_2px_4px_rgba(15,23,42,0.06)] outline-none backdrop-blur-sm transition focus:border-[#C0272D]/40 focus:ring-2 focus:ring-[#C0272D]/15 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]";

const PRIMARY_BUTTON_CLASS =
  "mt-6 w-full rounded-full bg-gradient-to-b from-slate-800 to-slate-950 py-3 font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_10px_25px_-8px_rgba(15,23,42,0.6),0_0_30px_-8px_rgba(192,39,45,0.35)] transition-all hover:brightness-110 active:scale-[0.98] active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.4)] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 dark:from-white dark:to-slate-100 dark:text-slate-900 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_10px_25px_-8px_rgba(0,0,0,0.5),0_0_30px_-8px_rgba(192,39,45,0.4)]";

const CALL_BUTTON_CLASS =
  "mt-5 w-full rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 py-3 font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_10px_25px_-8px_rgba(16,185,129,0.6)] transition-all hover:brightness-105 active:scale-[0.98] active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.25)] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 disabled:shadow-none";

const HANGUP_BUTTON_CLASS =
  "mt-3 w-full rounded-full bg-gradient-to-b from-[#e0555c] to-[#C0272D] py-3 font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_10px_25px_-8px_rgba(192,39,45,0.6)] transition-all hover:brightness-105 active:scale-[0.98] active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.25)] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 disabled:shadow-none";

const ICON_BUTTON_CLASS =
  "flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-white/60 bg-white/50 py-2.5 text-xs font-medium text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_6px_16px_-8px_rgba(15,23,42,0.25)] backdrop-blur-sm transition-all hover:bg-white/80 active:scale-[0.97] dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_6px_16px_-8px_rgba(0,0,0,0.5)] dark:hover:bg-white/10";

const ICON_BUTTON_ACTIVE_CLASS =
  "flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-[#C0272D]/30 bg-[#C0272D]/10 py-2.5 text-xs font-medium text-[#C0272D] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_6px_16px_-8px_rgba(192,39,45,0.4)] backdrop-blur-sm transition-all active:scale-[0.97] dark:border-[#C0272D]/40 dark:bg-[#C0272D]/15 dark:text-[#ff8087]";

const KEYPAD_BUTTON_CLASS =
  "flex h-11 items-center justify-center rounded-xl border border-white/60 bg-white/50 text-sm font-medium text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_4px_10px_-6px_rgba(15,23,42,0.3)] backdrop-blur-sm transition-all hover:bg-white/80 active:scale-95 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.15)] dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_4px_10px_-6px_rgba(0,0,0,0.5)] dark:hover:bg-white/10";

const ERROR_BANNER_CLASS =
  "rounded-2xl border border-red-200/60 bg-red-50/80 px-3 py-2 text-sm text-red-700 backdrop-blur-sm dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300";

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

async function requestToken(accessCode: string): Promise<{ token: string }> {
  const res = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessCode }),
  });

  const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };

  if (!res.ok || !data.token) {
    throw new Error(data.error || "Unable to unlock the dialer.");
  }

  return { token: data.token };
}

export default function Dialer() {
  const [unlocked, setUnlocked] = useState(false);
  const [accessCodeInput, setAccessCodeInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  const [micPermission, setMicPermission] = useState<MicPermission>("checking");
  const [deviceReady, setDeviceReady] = useState(false);

  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [outputSelectionSupported, setOutputSelectionSupported] = useState(false);

  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [callStatus, setCallStatus] = useState<CallStatus>("ready");
  const [callError, setCallError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // A short synthesized tap - no audio file to ship or go missing, just a
  // quick oscillator blip for tactile feedback on every dialer interaction.
  const playTap = useCallback(() => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = audioCtxRef.current ?? new AudioCtx();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume();

      const now = ctx.currentTime;

      const body = ctx.createOscillator();
      const bodyGain = ctx.createGain();
      body.type = "sine";
      body.frequency.setValueAtTime(220, now);
      body.frequency.exponentialRampToValueAtTime(85, now + 0.07);
      bodyGain.gain.setValueAtTime(0.16, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      body.connect(bodyGain).connect(ctx.destination);
      body.start(now);
      body.stop(now + 0.09);

      const tap = ctx.createOscillator();
      const tapGain = ctx.createGain();
      tap.type = "triangle";
      tap.frequency.setValueAtTime(1400, now);
      tapGain.gain.setValueAtTime(0.05, now);
      tapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
      tap.connect(tapGain).connect(ctx.destination);
      tap.start(now);
      tap.stop(now + 0.03);
    } catch {
      // Sound is a nice-to-have; never let it break the actual dialer.
    }
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
  }, [stopTimer]);

  const resetAfterCall = useCallback(() => {
    stopTimer();
    setCallStatus("ready");
    setMuted(false);
    setKeypadOpen(false);
    callRef.current = null;
  }, [stopTimer]);

  const attachCallHandlers = useCallback(
    (call: Call) => {
      call.on("ringing", () => setCallStatus("ringing"));
      call.on("accept", () => {
        setCallStatus("in-call");
        startTimer();
      });
      call.on("disconnect", () => resetAfterCall());
      call.on("cancel", () => resetAfterCall());
      call.on("reject", () => {
        setCallError("The call was rejected.");
        resetAfterCall();
      });
      call.on("error", (error: DeviceErrorLike) => {
        setCallError(friendlyError(error));
        resetAfterCall();
      });
    },
    [resetAfterCall, startTimer],
  );

  // Reads the current input/output device lists from the Twilio Device's
  // AudioHelper. Bluetooth headsets need no special handling - once paired
  // with the OS, they just show up here like any other device, and macOS
  // fires the SDK's "deviceChange" event when one connects or disconnects.
  const refreshDevices = useCallback((device: Device) => {
    const audio = device.audio;
    if (!audio) return;

    const inputs = Array.from(audio.availableInputDevices.values());
    const outputs = Array.from(audio.availableOutputDevices.values());
    setInputDevices(inputs);
    setOutputDevices(outputs);
    setOutputSelectionSupported(audio.isOutputSelectionSupported);

    setSelectedInputId((current) => {
      if (current && inputs.some((d) => d.deviceId === current)) return current;
      return audio.inputDevice?.deviceId || inputs[0]?.deviceId || "";
    });
    setSelectedOutputId((current) => {
      if (current && outputs.some((d) => d.deviceId === current)) return current;
      const active = Array.from(audio.speakerDevices.get())[0];
      return active?.deviceId || outputs[0]?.deviceId || "";
    });
  }, []);

  const setupDevice = useCallback(
    async (token: string) => {
      const { Device: TwilioDevice } = await import("@twilio/voice-sdk");
      const device = new TwilioDevice(token);

      device.on("tokenWillExpire", async () => {
        const savedCode = sessionStorage.getItem(STORAGE_KEY);
        if (!savedCode) return;
        try {
          const { token: freshToken } = await requestToken(savedCode);
          device.updateToken(freshToken);
        } catch {
          // The token will simply expire; the next call attempt will surface
          // a clear "session expired" error via the device's own error event.
        }
      });

      device.on("error", (error: DeviceErrorLike) => {
        setCallError(friendlyError(error));
      });

      device.audio?.on("deviceChange", () => refreshDevices(device));

      deviceRef.current = device;
      setDeviceReady(true);
      refreshDevices(device);
    },
    [refreshDevices],
  );

  // Proactively ask for microphone access once unlocked, so the user sees a
  // clear status instead of being surprised by the browser prompt mid-call.
  useEffect(() => {
    if (!unlocked) return;

    let cancelled = false;

    async function checkMic() {
      setMicPermission("checking");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        if (!cancelled) {
          setMicPermission("granted");
          // Device labels are blank until permission is granted, so refresh
          // the picker lists now that they should be populated.
          if (deviceRef.current) refreshDevices(deviceRef.current);
        }
      } catch {
        if (!cancelled) setMicPermission("denied");
      }
    }

    checkMic();
    return () => {
      cancelled = true;
    };
  }, [unlocked, refreshDevices]);

  useEffect(() => {
    return () => {
      stopTimer();
      deviceRef.current?.destroy();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [stopTimer]);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    playTap();
    setLockError(null);
    setUnlocking(true);
    try {
      const { token } = await requestToken(accessCodeInput);
      sessionStorage.setItem(STORAGE_KEY, accessCodeInput);
      await setupDevice(token);
      setUnlocked(true);
    } catch (err) {
      setLockError(err instanceof Error ? err.message : "Unable to unlock the dialer.");
    } finally {
      setUnlocking(false);
    }
  }

  function handleSignOut() {
    playTap();
    deviceRef.current?.destroy();
    deviceRef.current = null;
    sessionStorage.removeItem(STORAGE_KEY);
    setUnlocked(false);
    setDeviceReady(false);
    setAccessCodeInput("");
    setPhoneNumber("");
    setInputDevices([]);
    setOutputDevices([]);
    resetAfterCall();
  }

  async function handleCall(e: React.FormEvent) {
    e.preventDefault();
    playTap();
    setCallError(null);
    setPhoneError(null);

    const normalized = normalizePhoneNumber(phoneNumber);
    if (!isValidE164(normalized)) {
      setPhoneError("Enter the number in international format, e.g. +12065551234");
      return;
    }

    if (!deviceRef.current || micPermission !== "granted") return;

    try {
      setCallStatus("connecting");
      const call = await deviceRef.current.connect({ params: { To: normalized } });
      callRef.current = call;
      attachCallHandlers(call);
    } catch (err) {
      setCallError(err instanceof Error ? err.message : "Could not start the call.");
      resetAfterCall();
    }
  }

  function handleHangUp() {
    playTap();
    setCallStatus("wrapping-up");
    callRef.current?.disconnect();
    deviceRef.current?.disconnectAll();
  }

  function handleToggleMute() {
    playTap();
    const next = !muted;
    callRef.current?.mute(next);
    setMuted(next);
  }

  function handleKeypadPress(digit: string) {
    playTap();
    callRef.current?.sendDigits(digit);
  }

  async function handleInputDeviceChange(id: string) {
    setSelectedInputId(id);
    try {
      await deviceRef.current?.audio?.setInputDevice(id);
    } catch {
      // Non-critical; the call keeps using whatever device was active.
    }
  }

  async function handleOutputDeviceChange(id: string) {
    setSelectedOutputId(id);
    try {
      await deviceRef.current?.audio?.speakerDevices.set(id);
    } catch {
      // Non-critical; audio keeps routing to whatever device was active.
    }
  }

  const canCall = deviceReady && micPermission === "granted" && callStatus === "ready" && phoneNumber.trim().length > 0;
  const canHangUp = callStatus === "connecting" || callStatus === "ringing" || callStatus === "in-call";

  const statusLabel = (() => {
    if (micPermission === "checking") return "Checking microphone access…";
    if (micPermission === "denied") return "Microphone blocked";
    switch (callStatus) {
      case "ready":
        return "Ready";
      case "connecting":
        return "Calling…";
      case "ringing":
        return "Ringing…";
      case "in-call":
        return `In call · ${formatDuration(elapsedSeconds)}`;
      case "wrapping-up":
        return "Ending call…";
    }
  })();

  if (!unlocked) {
    return (
      <Shell>
        <form onSubmit={handleUnlock} className={CARD_CLASS}>
          <Logo />
          <h1 className="mt-4 text-center text-lg font-semibold tracking-wide text-slate-900 dark:text-white">
            BUSINESS <span className="text-[#C0272D]">CALLER</span>
          </h1>
          <p className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">
            Enter your access code to continue
          </p>

          <label htmlFor="accessCode" className="mt-6 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Access Code
          </label>
          <input
            id="accessCode"
            type="password"
            autoComplete="off"
            value={accessCodeInput}
            onChange={(e) => setAccessCodeInput(e.target.value)}
            className={INPUT_CLASS}
            placeholder="••••••••"
            required
          />

          {lockError && <p className={`mt-3 ${ERROR_BANNER_CLASS}`}>{lockError}</p>}

          <button type="submit" disabled={unlocking} className={PRIMARY_BUTTON_CLASS}>
            {unlocking ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className={CARD_CLASS}>
        <Logo />
        <div className="mt-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-wide text-slate-900 dark:text-white">
            BUSINESS <span className="text-[#C0272D]">CALLER</span>
          </h1>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={canHangUp}
            className="text-xs font-medium text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-500 dark:hover:text-slate-300"
          >
            Sign out
          </button>
        </div>
        <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-white/50 px-2.5 py-1 text-xs font-medium text-slate-500 backdrop-blur-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-[#C0272D]" />
          Calling from {DISPLAY_CALLER_ID}
        </p>

        <div className={`mt-4 grid gap-2 ${outputSelectionSupported ? "grid-cols-2" : "grid-cols-1"}`}>
          <div className="relative">
            <MicIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <select
              aria-label="Microphone"
              value={selectedInputId}
              onChange={(e) => handleInputDeviceChange(e.target.value)}
              disabled={inputDevices.length === 0}
              className={SELECT_CLASS}
            >
              {inputDevices.length === 0 && <option>Default microphone</option>}
              {inputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Microphone"}
                </option>
              ))}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
          </div>

          {outputSelectionSupported && (
            <div className="relative">
              <SpeakerIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <select
                aria-label="Speaker"
                value={selectedOutputId}
                onChange={(e) => handleOutputDeviceChange(e.target.value)}
                disabled={outputDevices.length === 0}
                className={SELECT_CLASS}
              >
                {outputDevices.length === 0 && <option>Default speaker</option>}
                {outputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || "Speaker"}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
            </div>
          )}
        </div>

        <form onSubmit={handleCall} className="mt-5">
          <label htmlFor="phoneNumber" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Phone Number
          </label>
          <input
            id="phoneNumber"
            type="tel"
            inputMode="tel"
            value={phoneNumber}
            onChange={(e) => {
              setPhoneNumber(e.target.value);
              setPhoneError(null);
            }}
            disabled={callStatus !== "ready"}
            className={INPUT_CLASS}
            placeholder="+1 555 123 4567"
          />
          {phoneError && (
            <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{phoneError}</p>
          )}

          <button type="submit" disabled={!canCall} className={CALL_BUTTON_CLASS}>
            Call
          </button>

          <button type="button" onClick={handleHangUp} disabled={!canHangUp} className={HANGUP_BUTTON_CLASS}>
            Hang Up
          </button>
        </form>

        {callStatus === "in-call" && (
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={handleToggleMute} className={muted ? ICON_BUTTON_ACTIVE_CLASS : ICON_BUTTON_CLASS}>
              <MicOffIcon className="h-4 w-4" />
              {muted ? "Muted" : "Mute"}
            </button>
            <button
              type="button"
              onClick={() => {
                playTap();
                setKeypadOpen((v) => !v);
              }}
              className={keypadOpen ? ICON_BUTTON_ACTIVE_CLASS : ICON_BUTTON_CLASS}
            >
              <KeypadIcon className="h-4 w-4" />
              Keypad
            </button>
          </div>
        )}

        {callStatus === "in-call" && keypadOpen && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {KEYPAD_DIGITS.map((digit) => (
              <button key={digit} type="button" onClick={() => handleKeypadPress(digit)} className={KEYPAD_BUTTON_CLASS}>
                {digit}
              </button>
            ))}
          </div>
        )}

        {callError && <p className={`mt-4 ${ERROR_BANNER_CLASS}`}>{callError}</p>}

        {micPermission === "denied" && (
          <p className="mt-4 rounded-2xl border border-amber-200/60 bg-amber-50/80 px-3 py-2 text-sm text-amber-800 backdrop-blur-sm dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300">
            Microphone access is blocked. Allow microphone access for this site in your
            browser&apos;s settings, then reload the page.
          </p>
        )}

        <div className="mt-6 flex items-center justify-center gap-2 border-t border-slate-900/5 pt-4 dark:border-white/5">
          <span
            className={`h-2.5 w-2.5 rounded-full transition-all ${
              callStatus === "in-call"
                ? "bg-emerald-500 shadow-[0_0_10px_3px_rgba(16,185,129,0.6)]"
                : micPermission === "denied"
                  ? "bg-red-500 shadow-[0_0_10px_3px_rgba(239,68,68,0.5)]"
                  : callStatus === "ready"
                    ? "bg-slate-300 dark:bg-slate-600"
                    : "animate-pulse bg-amber-500 shadow-[0_0_10px_3px_rgba(245,158,11,0.5)]"
            }`}
          />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Status: {statusLabel}
          </p>
        </div>
      </div>
    </Shell>
  );
}
