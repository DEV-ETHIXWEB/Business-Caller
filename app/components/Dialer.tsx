"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";

// The number clients will see on their caller ID. This is display-only;
// the number actually used to place the call is TWILIO_PHONE_NUMBER on the
// server (app/api/voice/route.ts). Keep these in sync if the number ever
// changes.
const DISPLAY_CALLER_ID = "+1 (206) 452-3433";

const STORAGE_KEY = "dialer_access_code";

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

  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [callStatus, setCallStatus] = useState<CallStatus>("ready");
  const [callError, setCallError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

      deviceRef.current = device;
      setDeviceReady(true);
    },
    [],
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
        if (!cancelled) setMicPermission("granted");
      } catch {
        if (!cancelled) setMicPermission("denied");
      }
    }

    checkMic();
    return () => {
      cancelled = true;
    };
  }, [unlocked]);

  useEffect(() => {
    return () => {
      stopTimer();
      deviceRef.current?.destroy();
    };
  }, [stopTimer]);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
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
    deviceRef.current?.destroy();
    deviceRef.current = null;
    sessionStorage.removeItem(STORAGE_KEY);
    setUnlocked(false);
    setDeviceReady(false);
    setAccessCodeInput("");
    setPhoneNumber("");
    resetAfterCall();
  }

  async function handleCall(e: React.FormEvent) {
    e.preventDefault();
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
    setCallStatus("wrapping-up");
    callRef.current?.disconnect();
    deviceRef.current?.disconnectAll();
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
      <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
        <form
          onSubmit={handleUnlock}
          className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <h1 className="text-center text-lg font-semibold tracking-wide text-slate-900 dark:text-slate-50">
            BUSINESS CALLER
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
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50 dark:focus:ring-slate-700"
            placeholder="••••••••"
            required
          />

          {lockError && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {lockError}
            </p>
          )}

          <button
            type="submit"
            disabled={unlocking}
            className="mt-6 w-full rounded-full bg-slate-900 py-3 font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {unlocking ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-8 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-wide text-slate-900 dark:text-slate-50">
            BUSINESS CALLER
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
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          Calling from {DISPLAY_CALLER_ID}
        </p>

        <form onSubmit={handleCall} className="mt-6">
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
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50 dark:focus:ring-slate-700 dark:disabled:bg-slate-900"
            placeholder="+1 555 123 4567"
          />
          {phoneError && (
            <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{phoneError}</p>
          )}

          <button
            type="submit"
            disabled={!canCall}
            className="mt-5 w-full rounded-full bg-emerald-600 py-3 font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Call
          </button>

          <button
            type="button"
            onClick={handleHangUp}
            disabled={!canHangUp}
            className="mt-3 w-full rounded-full bg-red-600 py-3 font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Hang Up
          </button>
        </form>

        {callError && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {callError}
          </p>
        )}

        {micPermission === "denied" && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Microphone access is blocked. Allow microphone access for this site in your
            browser&apos;s settings, then reload the page.
          </p>
        )}

        <div className="mt-6 flex items-center justify-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <span
            className={`h-2 w-2 rounded-full ${
              callStatus === "in-call"
                ? "bg-emerald-500"
                : micPermission === "denied"
                  ? "bg-red-500"
                  : callStatus === "ready"
                    ? "bg-slate-300 dark:bg-slate-600"
                    : "bg-amber-500"
            }`}
          />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Status: {statusLabel}
          </p>
        </div>
      </div>
    </div>
  );
}
