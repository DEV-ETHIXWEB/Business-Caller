"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { isValidPin } from "@/lib/lock";
import { BackspaceIcon, LockIcon } from "../icons";
import { FIELD_CLASS, PRIMARY_CLASS, Sheet } from "../chat/Sheet";

export interface PinAttempt {
  ok: boolean;
  /** Seconds to wait before the next try, if too many were wrong. */
  waitSeconds?: number;
}

// The keypad: dots for the digits typed, a 3 by 4 grid of keys, and the
// keyboard works too. Wrong tries shake and clear; too many make you wait.
export function PinPad({
  length,
  title,
  subtitle,
  onSubmit,
  initialWait = 0,
  footer,
}: {
  length: number;
  title: string;
  subtitle?: string;
  onSubmit: (pin: string) => Promise<PinAttempt>;
  initialWait?: number;
  footer?: React.ReactNode;
}) {
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [wait, setWait] = useState(initialWait);
  const [busy, setBusy] = useState(false);
  const digitsRef = useRef("");

  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(t);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function push(d: string) {
    if (busy || wait > 0 || digitsRef.current.length >= length) return;
    const next = digitsRef.current + d;
    digitsRef.current = next;
    setDigits(next);
    setError(null);
    if (next.length === length) {
      setBusy(true);
      const res = await onSubmit(next);
      setBusy(false);
      if (!res.ok) {
        digitsRef.current = "";
        setDigits("");
        setShake(true);
        setTimeout(() => setShake(false), 450);
        if (res.waitSeconds) setWait(res.waitSeconds);
        setError(res.waitSeconds ? "Too many wrong tries." : "Wrong PIN. Try again.");
      }
    }
  }

  function back() {
    digitsRef.current = digitsRef.current.slice(0, -1);
    setDigits(digitsRef.current);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (/^\d$/.test(e.key)) void push(e.key);
      else if (e.key === "Backspace") back();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const key = "flex h-16 w-16 items-center justify-center rounded-full border border-white/60 bg-white/70 text-2xl font-medium text-slate-800 shadow-[0_8px_16px_-8px_rgba(15,23,42,0.4)] transition-all active:scale-90 disabled:opacity-40 dark:border-white/10 dark:bg-white/10 dark:text-slate-100";

  return (
    <div className="flex flex-col items-center px-6" data-testid="pin-pad">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white shadow-[0_12px_24px_-10px_rgba(192,39,45,0.7)]">
        <LockIcon className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-slate-900 dark:text-white">{title}</h2>
      {subtitle && <p className="mt-1 max-w-xs text-center text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}

      <div className={`mt-6 flex gap-3 ${shake ? "animate-[pin-shake_0.4s]" : ""}`} role="img" aria-label={`${digits.length} of ${length} digits entered`}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={`h-3.5 w-3.5 rounded-full border-2 transition-all ${i < digits.length ? "scale-110 border-[#C0272D] bg-[#C0272D]" : "border-slate-400 dark:border-slate-500"}`} />
        ))}
      </div>
      <p className="mt-3 h-5 text-sm text-[#C0272D] dark:text-[#ff6b72]" role="alert">
        {wait > 0 ? `Too many wrong tries. Try again in ${wait}s.` : error}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-x-5 gap-y-4">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" onClick={() => void push(d)} disabled={wait > 0 || busy} className={key} aria-label={d}>
            {d}
          </button>
        ))}
        <span />
        <button type="button" onClick={() => void push("0")} disabled={wait > 0 || busy} className={key} aria-label="0">
          0
        </button>
        <button type="button" onClick={back} disabled={busy} className={`${key} !border-transparent !bg-transparent !shadow-none`} aria-label="Delete last digit of the PIN">
          <BackspaceIcon className="h-6 w-6" />
        </button>
      </div>
      {footer && <div className="mt-6 text-center">{footer}</div>}
    </div>
  );
}

// Covers the whole app until the PIN is entered.
export function LockScreen({ length, onSubmit, initialWait, onForgot }: { length: number; onSubmit: (pin: string) => Promise<PinAttempt>; initialWait: number; onForgot: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="App locked"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-br from-[#F7F2F1] via-white to-[#F5EFEE] dark:from-[#0c0d10] dark:via-[#120a0b] dark:to-black"
    >
      <Image src="/ethixweb-logo.png" alt="Ethixweb" width={140} height={22} className="mb-8 h-5 w-auto dark:invert" />
      <PinPad
        length={length}
        title="Enter your PIN"
        subtitle="Business Caller is locked."
        onSubmit={onSubmit}
        initialWait={initialWait}
        footer={
          <button type="button" onClick={onForgot} className="text-sm font-semibold text-[#C0272D] dark:text-[#ff6b72]">
            Forgot PIN? Sign out
          </button>
        }
      />
    </div>
  );
}

// Asks for the PIN before doing something sensitive.
export function PinPromptSheet({ length, title, onSubmit, onClose, initialWait }: { length: number; title: string; onSubmit: (pin: string) => Promise<PinAttempt>; onClose: () => void; initialWait: number }) {
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 backdrop-blur-sm animate-[fade-in_0.15s_ease-out] lg:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-3xl border border-white/70 bg-white px-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 shadow-[0_-20px_50px_-15px_rgba(15,23,42,0.4)] animate-[slide-fade-in_0.2s_ease-out] dark:border-white/10 dark:bg-[#17181c] lg:max-w-sm lg:rounded-3xl"
      >
        <PinPad
          length={length}
          title={title}
          onSubmit={async (pin) => {
            const res = await onSubmit(pin);
            return res;
          }}
          initialWait={initialWait}
          footer={
            <button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              Cancel
            </button>
          }
        />
      </div>
    </div>,
    document.body,
  );
}

export function PinSetupSheet({ title, onSet, onClose }: { title: string; onSet: (pin: string) => void; onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const problem = pin && !isValidPin(pin) ? "Use 4 to 8 digits." : again && pin !== again ? "The two PINs do not match." : null;
  const ready = isValidPin(pin) && pin === again;
  return (
    <Sheet
      title={title}
      onClose={onClose}
      z={90}
      footer={
        <button type="button" disabled={!ready} onClick={() => { onSet(pin); onClose(); }} className={PRIMARY_CLASS}>
          Save PIN
        </button>
      }
    >
      <p className="text-sm text-slate-500 dark:text-slate-400">A PIN of 4 to 8 digits. It stays on this device, and only a scrambled copy of it is kept.</p>
      <label htmlFor="pin-new" className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">New PIN</label>
      <input id="pin-new" autoFocus type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-label="New PIN" className={`mt-1 ${FIELD_CLASS}`} />
      <label htmlFor="pin-again" className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Confirm PIN</label>
      <input id="pin-again" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ""))} aria-label="Confirm PIN" className={`mt-1 ${FIELD_CLASS}`} />
      <p className="mt-2 h-5 text-sm text-[#C0272D] dark:text-[#ff6b72]" role="alert">{problem}</p>
    </Sheet>
  );
}

export function SecretSheet({ onSet, onClose }: { onSet: (word: string) => void; onClose: () => void }) {
  const [word, setWord] = useState("");
  const ok = word.trim().length >= 4 && word.trim().length <= 20;
  return (
    <Sheet
      title="Secret code"
      onClose={onClose}
      z={90}
      footer={
        <button type="button" disabled={!ok} onClick={() => { onSet(word.trim()); onClose(); }} className={PRIMARY_CLASS}>
          Save secret code
        </button>
      }
    >
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Typing this word in the chat search box opens your locked chats, so they stay out of sight until you want them. Choose 4 to 20 characters.
      </p>
      <input autoFocus type="password" autoComplete="off" maxLength={20} value={word} onChange={(e) => setWord(e.target.value)} aria-label="Secret code" placeholder="A word only you know" className={`mt-4 ${FIELD_CLASS}`} />
    </Sheet>
  );
}
