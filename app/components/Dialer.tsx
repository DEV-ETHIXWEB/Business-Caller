"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import type { Call, Device } from "@twilio/voice-sdk";
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import type { Contact } from "@/lib/contacts";
import type { ConversationSummary, ThreadMessage } from "@/lib/messageThread";
import type { CallLogEntry } from "@/lib/callLog";
import type { PublicCredentialInfo } from "@/lib/webauthn";
import { Avatar, PRESET_COUNT } from "./Avatar";

const MAX_SMS_LENGTH = 1600;

// The standard phone-keypad letter mapping (ITU E.161) - shown as small
// subtext under each digit, the way a real phone dialer looks.
const KEYPAD_DIGITS: { digit: string; letters: string }[] = [
  { digit: "1", letters: "" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
  { digit: "*", letters: "" },
  { digit: "0", letters: "+" },
  { digit: "#", letters: "" },
];

// The credentials are remembered for 14 days, refreshed on every successful
// login (password or biometric) and every time an already-valid session is
// found on load - so staying logged in only requires opening the app at
// least once every 14 days, not 14 days from a single fixed login. Uses
// localStorage rather than sessionStorage specifically so it survives the
// browser being closed and reopened.
const SESSION_KEY = "dialer_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface StoredSession {
  username: string;
  password: string;
  expiresAt: number;
}

interface Credentials {
  username: string;
  password: string;
}

function saveSession(username: string, password: string) {
  try {
    const session: StoredSession = { username, password, expiresAt: Date.now() + SESSION_TTL_MS };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage can be unavailable (private browsing, quota) - worst case,
    // the credentials are just asked for again next time.
  }
}

function loadSession(): Credentials | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof session.username !== "string" || typeof session.password !== "string" || typeof session.expiresAt !== "number") {
      return null;
    }
    if (Date.now() > session.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return { username: session.username, password: session.password };
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

type CallStatus = "ready" | "connecting" | "ringing" | "in-call" | "wrapping-up";
type MicPermission = "checking" | "granted" | "denied";

interface CallParticipant {
  callSid: string;
  number: string;
  onHold: boolean;
}

interface DeviceErrorLike {
  code?: number;
  message?: string;
}

function friendlyError(error: DeviceErrorLike): string {
  switch (error.code) {
    case 20101:
    case 20104:
      return "Your session expired. Please sign out and sign in again.";
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

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function BackspaceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 5H20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6.5-7Z" />
      <path d="M13 10l4 4M17 10l-4 4" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function PersonPlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M18 8v6M15 11h6" />
    </svg>
  );
}

function MergeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 4v6a4 4 0 0 0 4 4h4" />
      <path d="M14 10l4 4-4 4" />
      <path d="M6 20v-6" />
    </svg>
  );
}

function PeopleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="9" cy="8" r="3" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16.5 8.5a3 3 0 1 1 3.9 2.86" />
      <path d="M16 14.5c2.7.4 4.5 1.9 5 3.5" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function ArrowDownRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7 7l10 10M17 8v9h-9" />
    </svg>
  );
}

function ArrowUpRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

function FingerprintIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 10a2 2 0 0 1 2 2c0 2.8-.6 5-2.5 7" />
      <path d="M8.5 14.5c.7-1 1-2 1-3.5a2.5 2.5 0 0 1 5 0c0 .3 0 .6-.03.9" />
      <path d="M5.5 12.5c0-.7.1-1.4.3-2" />
      <path d="M17.7 16.6c.5-1.5.8-3 .8-4.6a6.5 6.5 0 0 0-11.4-4.3" />
      <path d="M12 3a9 9 0 0 1 9 9c0 .8-.06 1.5-.2 2.2" />
      <path d="M3.1 15a9 9 0 0 1-.1-3" />
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

const COMPACT_INPUT_CLASS =
  "w-full rounded-xl border border-white/70 bg-white/60 px-3 py-2 text-sm text-slate-900 shadow-[inset_0_2px_6px_rgba(15,23,42,0.08)] outline-none backdrop-blur-sm transition placeholder:text-slate-400 focus:border-[#C0272D]/40 focus:bg-white/90 focus:ring-4 focus:ring-[#C0272D]/15 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:shadow-[inset_0_2px_6px_rgba(0,0,0,0.4)] dark:placeholder:text-slate-500 dark:focus:bg-white/10 dark:focus:ring-[#C0272D]/20";

const SELECT_CLASS =
  "w-full appearance-none rounded-xl border border-white/70 bg-white/60 py-2 pl-8 pr-7 text-[11px] font-medium text-slate-700 shadow-[inset_0_2px_4px_rgba(15,23,42,0.06)] outline-none backdrop-blur-sm transition focus:border-[#C0272D]/40 focus:ring-2 focus:ring-[#C0272D]/15 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]";

const PRIMARY_BUTTON_CLASS =
  "mt-6 w-full rounded-full bg-gradient-to-b from-slate-800 to-slate-950 py-3 font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_10px_25px_-8px_rgba(15,23,42,0.6),0_0_30px_-8px_rgba(192,39,45,0.35)] transition-all hover:brightness-110 active:scale-[0.98] active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.4)] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 dark:from-white dark:to-slate-100 dark:text-slate-900 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_10px_25px_-8px_rgba(0,0,0,0.5),0_0_30px_-8px_rgba(192,39,45,0.4)]";

const SMALL_BUTTON_CLASS =
  "w-full rounded-full bg-gradient-to-b from-slate-800 to-slate-950 py-2 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_18px_-8px_rgba(15,23,42,0.5)] transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:from-white dark:to-slate-100 dark:text-slate-900";

const KEYPAD_BUTTON_CLASS =
  "mx-auto flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-full border border-white/60 bg-white/50 font-medium text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_8px_16px_-8px_rgba(15,23,42,0.4),0_3px_6px_-3px_rgba(15,23,42,0.2)] backdrop-blur-sm transition-all duration-150 hover:bg-white/80 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_18px_-8px_rgba(192,39,45,0.3),0_4px_8px_-3px_rgba(192,39,45,0.2)] active:scale-90 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_16px_-8px_rgba(0,0,0,0.7),0_3px_6px_-3px_rgba(0,0,0,0.5)] dark:hover:bg-white/10";

function KeypadButton({ digit, letters, onClick }: { digit: string; letters: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={KEYPAD_BUTTON_CLASS}>
      <span className="text-lg leading-none">{digit}</span>
      <span className="h-2.5 text-[8px] font-semibold uppercase leading-none tracking-[0.15em] text-slate-400 dark:text-slate-500">
        {letters}
      </span>
    </button>
  );
}

const CALL_ACTION_CIRCLE_CLASS =
  "flex h-14 w-14 items-center justify-center rounded-full border border-white/60 bg-white/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_14px_26px_-10px_rgba(15,23,42,0.35),0_4px_10px_-4px_rgba(15,23,42,0.2)] backdrop-blur-sm transition-all hover:bg-white/80 active:scale-90 dark:border-white/10 dark:bg-white/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_14px_26px_-10px_rgba(0,0,0,0.6),0_4px_10px_-4px_rgba(0,0,0,0.4)] dark:hover:bg-white/10";

const CALL_ACTION_CIRCLE_ACTIVE_CLASS =
  "flex h-14 w-14 items-center justify-center rounded-full border border-[#C0272D]/30 bg-[#C0272D]/10 text-[#C0272D] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_14px_26px_-10px_rgba(192,39,45,0.5),0_4px_10px_-4px_rgba(192,39,45,0.3)] backdrop-blur-sm transition-all active:scale-90 dark:border-[#C0272D]/40 dark:bg-[#C0272D]/15 dark:text-[#ff8087]";

const CALL_BUTTON_CIRCLE_CLASS =
  "mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_20px_36px_-12px_rgba(16,185,129,0.7),0_6px_14px_-4px_rgba(16,185,129,0.4)] transition-all hover:brightness-105 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_24px_40px_-12px_rgba(16,185,129,0.75),0_8px_16px_-4px_rgba(16,185,129,0.45)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none";

const HANGUP_CIRCLE_CLASS =
  "mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_20px_36px_-12px_rgba(192,39,45,0.7),0_6px_14px_-4px_rgba(192,39,45,0.4)] transition-all hover:brightness-105 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_24px_40px_-12px_rgba(192,39,45,0.75),0_8px_16px_-4px_rgba(192,39,45,0.45)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none";

const HEADER_PILL_CLASS =
  "flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-b from-[#e0555c] to-[#C0272D] pl-3 pr-3.5 text-xs font-semibold text-white shadow-[0_8px_18px_-8px_rgba(192,39,45,0.7)] transition-all active:scale-95";

const MINI_ICON_BUTTON_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/60 bg-white/50 text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-sm transition-all hover:bg-white/80 active:scale-90 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10";

const ERROR_BANNER_CLASS =
  "rounded-2xl border border-red-200/60 bg-red-50/80 px-3 py-2 text-sm text-red-700 backdrop-blur-sm dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300";

const COMPACT_ERROR_CLASS = "text-xs text-red-600 dark:text-red-400";

const NAV_RAIL_CLASS =
  "hidden lg:flex lg:h-dvh lg:w-20 lg:shrink-0 lg:flex-col lg:items-center lg:gap-2 lg:border-r lg:border-white/50 lg:bg-white/60 lg:py-6 lg:backdrop-blur-2xl lg:backdrop-saturate-150 dark:lg:border-white/10 dark:lg:bg-white/[0.04]";

const NAV_BUTTON_BASE_CLASS = "flex w-16 flex-col items-center gap-1 rounded-2xl px-2 py-2.5 text-[10px] font-medium transition-all active:scale-95";

const NAV_BUTTON_ACTIVE_CLASS = `${NAV_BUTTON_BASE_CLASS} bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white shadow-[0_8px_20px_-8px_rgba(192,39,45,0.5)]`;

const NAV_BUTTON_INACTIVE_CLASS = `${NAV_BUTTON_BASE_CLASS} text-slate-500 hover:bg-white/70 dark:text-slate-400 dark:hover:bg-white/10`;

const BOTTOM_BAR_CLASS =
  "fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-white/60 bg-white/85 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-2xl backdrop-saturate-150 lg:hidden dark:border-white/10 dark:bg-[#0c0d10]/90";

const FAB_CLASS =
  "fixed bottom-20 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white shadow-[0_15px_35px_-10px_rgba(192,39,45,0.6)] transition-all hover:brightness-110 active:scale-95 lg:bottom-8 lg:right-8";

const MAIN_PANEL_CLASS =
  "flex h-full min-h-0 flex-1 flex-col rounded-[1.75rem] border border-white/70 bg-white/70 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_20px_50px_-20px_rgba(192,39,45,0.12),0_12px_28px_-15px_rgba(15,23,42,0.18)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_50px_-15px_rgba(192,39,45,0.2),0_15px_45px_-20px_rgba(0,0,0,0.8)]";

const LIST_ROW_CLASS =
  "flex w-full items-center gap-3 rounded-2xl border border-white/50 bg-white/40 px-3 py-2.5 text-left transition-all hover:bg-white/70 active:scale-[0.99] dark:border-white/5 dark:bg-white/[0.03] dark:hover:bg-white/[0.08]";

// Applied to each list row so they gently fade/slide in on mount, staggered
// a little per row. "backwards" fill mode holds the 0%-keyframe opacity
// during the delay, so a row doesn't flash visible before its turn.
const ROW_ENTRANCE_CLASS = "animate-[slide-fade-in_0.3s_ease-out_backwards]";

// Capped so a long list doesn't make the last rows wait ages to appear.
function staggerStyle(index: number): React.CSSProperties {
  return { animationDelay: `${Math.min(index, 8) * 30}ms` };
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function relativeDay(at: number): string {
  const date = new Date(at);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

const MISSED_STATUSES = new Set(["no-answer", "busy", "failed", "canceled"]);

function callStatusLabel(entry: CallLogEntry): string {
  if (MISSED_STATUSES.has(entry.status)) {
    return entry.direction === "inbound" ? "Missed" : "No answer";
  }
  const kind = entry.direction === "inbound" ? "Incoming" : "Outgoing";
  return entry.durationSeconds > 0 ? `${kind} · ${formatDuration(entry.durationSeconds)}` : kind;
}

async function requestToken(
  username: string,
  password: string,
): Promise<{ token: string; phoneNumber: string; label: string; avatarUrl?: string }> {
  const res = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    phoneNumber?: string;
    label?: string;
    avatarUrl?: string;
    error?: string;
  };

  if (!res.ok || !data.token || !data.phoneNumber) {
    throw new Error(data.error || "Unable to unlock the dialer.");
  }

  return { token: data.token, phoneNumber: data.phoneNumber, label: data.label ?? "", avatarUrl: data.avatarUrl };
}

// Resizes/compresses an uploaded photo client-side before it's ever sent to
// the server - keeps profile photo uploads small and consistent regardless
// of what the original file (a multi-MB phone camera shot, say) looked
// like. Uses a plain <img> element (not next/image's Image, which this file
// already imports under that name) since this only needs the browser's
// decode + canvas pipeline, not Next's optimizer.
function resizeImageToDataUrl(file: File, maxDimension: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => {
      const img = document.createElement("img");
      img.onerror = () => reject(new Error("Could not read the selected image."));
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not process the image."));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function guessDeviceLabel(): string {
  if (typeof navigator === "undefined") return "This device";
  const ua = navigator.userAgent;
  const platform = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Macintosh/.test(ua)
        ? "Mac"
        : /Android/.test(ua)
          ? "Android"
          : /Windows/.test(ua)
            ? "Windows"
            : "device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Safari\//.test(ua)
        ? "Safari"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : "browser";
  return `${browser} on ${platform}`;
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M3.4 20.4 21.3 12.7a.8.8 0 0 0 0-1.4L3.4 3.6a.8.8 0 0 0-1.1.9l1.6 6.3 8.6 1.2-8.6 1.2-1.6 6.3a.8.8 0 0 0 1.1.9Z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function DoubleCheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m2 12.5 4.5 4.5L16 7.5" />
      <path d="m10.5 16.6.4.4L20.5 7.5" />
    </svg>
  );
}

// WhatsApp-style delivery marks on your own messages: one tick sent, two
// delivered, and a plain-words note when the carrier rejected it.
function MessageTicks({ status }: { status: string }) {
  if (status === "failed" || status === "undelivered") {
    return <span className="font-semibold text-amber-200">Not delivered</span>;
  }
  if (status === "delivered" || status === "read") return <DoubleCheckIcon className="h-3.5 w-3.5" />;
  if (status === "sent" || status === "partially_delivered") return <CheckIcon className="h-3 w-3" />;
  return <CheckIcon className="h-3 w-3 opacity-50" />;
}

// Turns http(s) links inside a message into tappable links - the way
// WhatsApp does - without ever using innerHTML.
function linkify(text: string): React.ReactNode[] {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => {
    if (i % 2 === 0) return part;
    const trailing = part.match(/[.,!?;:)\]]+$/)?.[0] ?? "";
    const url = trailing ? part.slice(0, -trailing.length) : part;
    return (
      <span key={i}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="underline decoration-current/50 underline-offset-2"
        >
          {url}
        </a>
        {trailing}
      </span>
    );
  });
}

function dayLabel(at: number): string {
  const date = new Date(at);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(
    [],
    date.getFullYear() === now.getFullYear()
      ? { weekday: "long", month: "short", day: "numeric" }
      : { year: "numeric", month: "short", day: "numeric" },
  );
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function subscribeVisualViewport(notify: () => void) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", notify);
  vv.addEventListener("scroll", notify);
  return () => {
    vv.removeEventListener("resize", notify);
    vv.removeEventListener("scroll", notify);
  };
}

function visualViewportSnapshot(): string {
  const vv = window.visualViewport;
  return vv ? `${Math.round(vv.height)}|${Math.round(vv.offsetTop)}` : "";
}

// The part of the screen that is actually visible. On a phone this shrinks
// when the on-screen keyboard opens (and iOS may also scroll it), which is
// what lets the chat stay pinned exactly to the visible area - header at the
// top, message box right above the keyboard - so nothing jumps or zooms.
function useVisualViewport(): { height: number; top: number } | null {
  const key = useSyncExternalStore(subscribeVisualViewport, visualViewportSnapshot, () => "");
  if (!key) return null;
  const [height, top] = key.split("|").map(Number);
  return { height, top };
}

export default function Dialer() {
  const [unlocked, setUnlocked] = useState(false);
  // True only for the brief moment while checking for a remembered
  // session on load, so a returning user doesn't see the lock screen
  // flash before being auto-signed-in.
  const [checkingSession, setCheckingSession] = useState(true);
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  // Populated from /api/token once signed in - this dialer's own number,
  // shown as the caller ID and used to label the account.
  const [callerId, setCallerId] = useState("");
  const [signedInUsername, setSignedInUsername] = useState("");
  const [signedInLabel, setSignedInLabel] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  // Which of the three main tabs is showing - the Google Voice-style
  // Calls/Texts/Contacts split, shared by both the desktop nav rail and the
  // mobile bottom bar (there's no separate mobile-only layout anymore).
  const [activeTab, setActiveTab] = useState<"calls" | "texts" | "contacts">("calls");
  const [callLog, setCallLog] = useState<CallLogEntry[]>([]);
  const [callLogLoading, setCallLogLoading] = useState(false);

  // The "new call" screen - the keypad/number entry that used to be the
  // permanently-visible center card is now summoned on demand from the
  // Calls tab's floating action button, and stays open through the call
  // itself until it's hung up.
  const [dialOverlayOpen, setDialOverlayOpen] = useState(false);

  const [callsSearch, setCallsSearch] = useState("");
  const [textsSearch, setTextsSearch] = useState("");
  const [contactsSearch, setContactsSearch] = useState("");

  // Whether this browser/device has Face ID, Touch ID, or Windows Hello
  // available at all - checked once on mount, used to decide whether to
  // show the biometric option on the lock screen and in device settings.
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [registeringDevice, setRegisteringDevice] = useState(false);
  const [deviceSetupMessage, setDeviceSetupMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<PublicCredentialInfo[]>([]);

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

  // Hold / Add Call / Merge - see lib/conference.ts for how a plain call
  // gets lazily upgraded into a Twilio Conference the first time any of
  // these is used. browserCallSid is this call's own CallSid, known once
  // the Voice SDK's Call object reports it (right around when it connects).
  const [browserCallSid, setBrowserCallSid] = useState("");
  const [inConference, setInConference] = useState(false);
  const [conferenceParticipants, setConferenceParticipants] = useState<CallParticipant[]>([]);
  const [callActionBusy, setCallActionBusy] = useState(false);
  const [callActionError, setCallActionError] = useState<string | null>(null);
  const [addCallOpen, setAddCallOpen] = useState(false);
  const [addCallNumber, setAddCallNumber] = useState("");

  // Contacts are stored server-side (see app/api/contacts/route.ts) so the
  // same Phone Book shows up on every device, not just whichever browser
  // added a contact - fetched once unlocked, below.
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactNumber, setNewContactNumber] = useState("");
  const [contactFormError, setContactFormError] = useState<string | null>(null);

  const [messageTo, setMessageTo] = useState("");
  const [scrolledUp, setScrolledUp] = useState(false);
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [newContactOpen, setNewContactOpen] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [pendingMessages, setPendingMessages] = useState<ThreadMessage[]>([]);
  const [selectedMessageSid, setSelectedMessageSid] = useState<string | null>(null);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [messageLog, setMessageLog] = useState<ThreadMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);

  // Which conversation (if any) is open. Deliberately NOT derived from
  // messageTo on every keystroke - a partial, still-being-typed number can
  // already satisfy the E.164 length check (7+ digits) before the user is
  // done typing, which used to flip the view to "thread" mid-keystroke and
  // yank the input out from under them. This is only ever set explicitly:
  // submitting the "new message" number, or clicking a conversation/contact.
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const threadContactName = activeThread ? contacts.find((c) => c.number === activeThread)?.name : undefined;

  const stickToBottomRef = useRef(true);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const vv = useVisualViewport();
  const viewportHeight = vv?.height ?? 0;

  // Keep the conversation pinned to the latest message as new ones arrive
  // from polling or are sent - and when the keyboard opens/closes, which
  // resizes the visible area.
  // ...but only while you're already at the bottom - polling must never yank
  // you down while you're reading older messages.
  useEffect(() => {
    const el = threadScrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messageLog, pendingMessages, viewportHeight, activeThread, isDesktop]);

  // Escape drops the current message selection (desktop keyboards).
  useEffect(() => {
    if (!selectedMessageSid) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedMessageSid(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedMessageSid]);

  // A freshly opened chat always starts at the latest message.
  useEffect(() => {
    stickToBottomRef.current = true;
  }, [activeThread]);

  function handleThreadScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const away = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = away < 80;
    setScrolledUp(away > 240);
  }

  function jumpToLatest() {
    const el = threadScrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  // The message box grows with what's typed (up to a few lines), like a
  // messaging app, rather than staying a fixed-height box with its own scroll.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [messageBody, activeThread, isDesktop]);

  // Phone/browser Back closes an open chat instead of leaving the app.
  useEffect(() => {
    if (activeThread && !chatHistoryPushedRef.current) {
      window.history.pushState({ chat: true }, "");
      chatHistoryPushedRef.current = true;
    } else if (!activeThread && chatHistoryPushedRef.current) {
      chatHistoryPushedRef.current = false;
      if (window.history.state?.chat) window.history.back();
    }
  }, [activeThread]);

  useEffect(() => {
    function onPopState() {
      if (!chatHistoryPushedRef.current) return;
      chatHistoryPushedRef.current = false;
      setMessageTo("");
      setActiveThread(null);
      setSmsError(null);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const chatHistoryPushedRef = useRef(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  // A short synthesized tap - no audio file to ship or go missing, just a
  // quick oscillator blip for tactile feedback on every dialer interaction.
  // Called on every tap throughout the app (35+ call sites) - one shared
  // function, so both the sound and haptic feedback below apply everywhere
  // at once rather than needing to be wired into each button individually.
  const playTap = useCallback(() => {
    // Haptics: most Android browsers implement the Vibration API. iOS
    // Safari does not expose it at all (a WebKit platform choice, not
    // something a web app can work around), so this is silently a no-op
    // there - the sound below still plays on every platform regardless.
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(12);
      }
    } catch {
      // Never let a vibration failure affect anything else.
    }

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
      body.frequency.exponentialRampToValueAtTime(85, now + 0.08);
      bodyGain.gain.setValueAtTime(0.32, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      body.connect(bodyGain).connect(ctx.destination);
      body.start(now);
      body.stop(now + 0.11);

      const tap = ctx.createOscillator();
      const tapGain = ctx.createGain();
      tap.type = "triangle";
      tap.frequency.setValueAtTime(1400, now);
      tapGain.gain.setValueAtTime(0.11, now);
      tapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
      tap.connect(tapGain).connect(ctx.destination);
      tap.start(now);
      tap.stop(now + 0.035);
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
    setDialOverlayOpen(false);
    setBrowserCallSid("");
    setInConference(false);
    setConferenceParticipants([]);
    setCallActionError(null);
    setAddCallOpen(false);
    setAddCallNumber("");
    callRef.current = null;
  }, [stopTimer]);

  const attachCallHandlers = useCallback(
    (call: Call) => {
      call.on("ringing", () => setCallStatus("ringing"));
      call.on("accept", () => {
        setCallStatus("in-call");
        setBrowserCallSid(call.parameters.CallSid ?? "");
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
  // with the OS, they just show up here like any other device, and the SDK
  // fires "deviceChange" when one connects or disconnects.
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
        const saved = loadSession();
        if (!saved) return;
        try {
          const { token: freshToken } = await requestToken(saved.username, saved.password);
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

  // Auto-unlocks on load if a still-valid remembered session exists, so
  // opening the app doesn't ask for the access code again unless it's been
  // more than 14 days (or more than 14 days since the last time this ran
  // successfully - loadSession/saveSession together make it a sliding
  // window). Runs once on mount, before the lock screen would otherwise render.
  useEffect(() => {
    let cancelled = false;

    // Deferred via setTimeout (rather than run directly in the effect body)
    // so every setState call below - including the early-exit case - never
    // runs synchronously within this effect's own call stack.
    const timer = setTimeout(async () => {
      const saved = loadSession();
      if (!saved) {
        if (!cancelled) setCheckingSession(false);
        return;
      }

      try {
        const { token, phoneNumber, label, avatarUrl: fetchedAvatarUrl } = await requestToken(
          saved.username,
          saved.password,
        );
        if (cancelled) return;
        saveSession(saved.username, saved.password);
        setCallerId(phoneNumber);
        setSignedInUsername(saved.username);
        setSignedInLabel(label);
        setAvatarUrl(fetchedAvatarUrl);
        await setupDevice(token);
        if (!cancelled) setUnlocked(true);
      } catch {
        // The remembered credentials no longer work (e.g. the password was
        // rotated) - drop them and fall back to the normal lock screen.
        clearSession();
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [setupDevice]);

  // Checked once, regardless of lock state, so the lock screen can offer
  // the Face ID / Touch ID button and the unlocked screen can offer to
  // register this device only when the hardware actually supports it.
  useEffect(() => {
    if (!browserSupportsWebAuthn()) return;
    let cancelled = false;
    platformAuthenticatorIsAvailable()
      .then((available) => {
        if (!cancelled) setBiometricSupported(available);
      })
      .catch(() => {
        if (!cancelled) setBiometricSupported(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Twilio records every inbound and outbound SMS on the account regardless
  // of any webhook, so polling this endpoint - rather than keeping our own
  // local copy - is what makes a client's reply actually show up here.
  const fetchThread = useCallback(async (number: string) => {
    const saved = loadSession();
    if (!saved) return;
    setMessagesLoading(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saved, with: number }),
      });
      const data = (await res.json().catch(() => ({}))) as { messages?: ThreadMessage[] };
      if (res.ok && data.messages) {
        setMessageLog(data.messages);
      }
    } catch {
      // Silent - the next poll tick retries; a persistent connectivity
      // issue will already be visible from the dialer/SMS-send errors.
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!unlocked || !activeThread) return;

    // Deferred via setTimeout/setInterval (rather than called directly) so
    // the fetch - and the setState calls inside it - never run synchronously
    // within this effect's own call stack.
    const initial = setTimeout(() => fetchThread(activeThread), 0);
    const interval = setInterval(() => fetchThread(activeThread), 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [unlocked, activeThread, fetchThread]);

  // The conversation list (the "inbox" view shown when no thread is open)
  // is fetched once whenever it becomes visible, not polled continuously -
  // it's just an index of who you've talked to, not something that needs
  // second-by-second freshness the way an open thread does.
  const fetchConversations = useCallback(async () => {
    const saved = loadSession();
    if (!saved) return;
    setConversationsLoading(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saved),
      });
      const data = (await res.json().catch(() => ({}))) as { conversations?: ConversationSummary[] };
      if (res.ok && data.conversations) {
        setConversations(data.conversations);
      }
    } catch {
      // Silent - the list simply refreshes next time it's shown.
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!unlocked || activeThread) return;
    const timer = setTimeout(() => fetchConversations(), 0);
    return () => clearTimeout(timer);
  }, [unlocked, activeThread, fetchConversations]);

  // Contacts are shared across every device via app/api/contacts/route.ts -
  // fetched once on unlock, then re-fetched after every add/delete so this
  // browser's list stays in sync with whatever it just wrote.
  const fetchContacts = useCallback(async () => {
    const saved = loadSession();
    if (!saved) return;
    setContactsLoading(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saved),
      });
      const data = (await res.json().catch(() => ({}))) as { contacts?: Contact[] };
      if (res.ok && data.contacts) {
        setContacts(data.contacts);
      }
    } catch {
      // Silent - the list simply refreshes next time it's shown.
    } finally {
      setContactsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const timer = setTimeout(() => fetchContacts(), 0);
    return () => clearTimeout(timer);
  }, [unlocked, fetchContacts]);

  // Call history, read live from Twilio's own Call records the same way
  // Messages reads its history - fetched whenever the Calls tab is shown,
  // and again whenever a call just ended so the just-finished call appears
  // without switching away and back.
  const fetchCallLog = useCallback(async () => {
    const saved = loadSession();
    if (!saved) return;
    setCallLogLoading(true);
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saved),
      });
      const data = (await res.json().catch(() => ({}))) as { calls?: CallLogEntry[] };
      if (res.ok && data.calls) {
        setCallLog(data.calls);
      }
    } catch {
      // Silent - the list simply refreshes next time the tab is shown.
    } finally {
      setCallLogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!unlocked || activeTab !== "calls") return;
    const timer = setTimeout(() => fetchCallLog(), 0);
    return () => clearTimeout(timer);
  }, [unlocked, activeTab, callStatus, fetchCallLog]);

  // Whether this call has been upgraded to a Twilio Conference yet (Hold or
  // Add Call used at least once - see lib/conference.ts) and, if so, who
  // else is on it and their hold state. Polled rather than pushed, since
  // Twilio's conference events land on the server, not the browser.
  const fetchCallStatus = useCallback(async () => {
    const saved = loadSession();
    if (!saved || !browserCallSid) return;
    try {
      const res = await fetch("/api/calls/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saved, browserCallSid }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        inConference?: boolean;
        participants?: CallParticipant[];
      };
      if (res.ok) {
        setInConference(Boolean(data.inConference));
        setConferenceParticipants(data.participants ?? []);
      }
    } catch {
      // Silent - the next poll tick retries.
    }
  }, [browserCallSid]);

  // Only polls once a conference actually exists. A normal call that never
  // used Hold/Add Call has nothing to poll for, and each poll costs several
  // Twilio API calls - the first status is fetched right after the action
  // (handleToggleHold/handleAddCallSubmit) that creates the conference.
  useEffect(() => {
    if (callStatus !== "in-call" || !browserCallSid || !inConference) return;
    const interval = setInterval(() => fetchCallStatus(), 5000);
    return () => clearInterval(interval);
  }, [callStatus, browserCallSid, inConference, fetchCallStatus]);

  // Puts the other party (or, once there's more than one, a specific
  // participant) on hold. The very first Hold or Add Call on a given call
  // is what triggers the server's lazy conference upgrade.
  async function handleToggleHold(participantCallSid: string | undefined, hold: boolean) {
    playTap();
    const saved = loadSession();
    if (!saved || !browserCallSid) return;
    setCallActionBusy(true);
    setCallActionError(null);
    try {
      const res = await fetch("/api/calls/hold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saved, browserCallSid, participantCallSid, hold }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not update hold.");
      await fetchCallStatus();
    } catch (err) {
      setCallActionError(err instanceof Error ? err.message : "Could not update hold.");
    } finally {
      setCallActionBusy(false);
    }
  }

  async function handleAddCallSubmit(e: React.FormEvent) {
    e.preventDefault();
    playTap();
    setCallActionError(null);

    const saved = loadSession();
    if (!saved || !browserCallSid) return;

    const normalized = normalizePhoneNumber(addCallNumber);
    if (!isValidE164(normalized)) {
      setCallActionError("Enter the number in international format, e.g. +12065551234");
      return;
    }

    setCallActionBusy(true);
    try {
      const res = await fetch("/api/calls/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saved, browserCallSid, to: normalized }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not add the call.");
      setAddCallOpen(false);
      setAddCallNumber("");
      await fetchCallStatus();
    } catch (err) {
      setCallActionError(err instanceof Error ? err.message : "Could not add the call.");
    } finally {
      setCallActionBusy(false);
    }
  }

  // Takes every held participant off hold at once.
  async function handleMerge() {
    playTap();
    const saved = loadSession();
    if (!saved || !browserCallSid) return;
    setCallActionBusy(true);
    setCallActionError(null);
    try {
      const res = await fetch("/api/calls/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saved, browserCallSid }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not merge.");
      await fetchCallStatus();
    } catch (err) {
      setCallActionError(err instanceof Error ? err.message : "Could not merge.");
    } finally {
      setCallActionBusy(false);
    }
  }

  // Writes the full contact list back to the server. Used by both add and
  // delete, since the API replaces the whole list rather than patching one
  // entry at a time.
  async function saveContactsToServer(next: Contact[]): Promise<boolean> {
    const saved = loadSession();
    if (!saved) return false;
    try {
      const res = await fetch("/api/contacts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saved, contacts: next }),
      });
      if (!res.ok) return false;
      const data = (await res.json().catch(() => ({}))) as { contacts?: Contact[] };
      if (data.contacts) setContacts(data.contacts);
      return true;
    } catch {
      return false;
    }
  }

  const fetchDevices = useCallback(async () => {
    const saved = loadSession();
    if (!saved) return;
    try {
      const res = await fetch("/api/webauthn/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saved),
      });
      const data = (await res.json().catch(() => ({}))) as { devices?: PublicCredentialInfo[] };
      if (res.ok && data.devices) setDevices(data.devices);
    } catch {
      // Silent - the list simply refreshes next time it's shown.
    }
  }, []);

  useEffect(() => {
    if (!unlocked || !biometricSupported) return;
    const timer = setTimeout(() => fetchDevices(), 0);
    return () => clearTimeout(timer);
  }, [unlocked, biometricSupported, fetchDevices]);

  // Tries a biometric unlock from the lock screen. Any failure here - the
  // user cancelling the OS prompt, nothing registered on this device yet,
  // or a real verification failure - falls back silently to the access
  // code field rather than showing an alarming error for what is usually
  // just "I'll type the password instead."
  async function handleBiometricUnlock() {
    playTap();
    const username = usernameInput.trim();
    if (!username) {
      setLockError("Enter your username first.");
      return;
    }
    setBiometricBusy(true);
    setLockError(null);
    try {
      const optsRes = await fetch("/api/webauthn/login-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const optsData = (await optsRes.json().catch(() => ({}))) as {
        options?: Parameters<typeof startAuthentication>[0]["optionsJSON"];
      };
      if (!optsRes.ok || !optsData.options) throw new Error("Could not start Face ID / Touch ID.");

      const assertion = await startAuthentication({ optionsJSON: optsData.options });

      const verifyRes = await fetch("/api/webauthn/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, response: assertion, expectedChallenge: optsData.options.challenge }),
      });
      const verifyData = (await verifyRes.json().catch(() => ({}))) as { username?: string; password?: string };
      if (!verifyRes.ok || !verifyData.username || !verifyData.password) throw new Error("Could not verify.");

      const { token, phoneNumber, label, avatarUrl: fetchedAvatarUrl } = await requestToken(
        verifyData.username,
        verifyData.password,
      );
      saveSession(verifyData.username, verifyData.password);
      setCallerId(phoneNumber);
      setSignedInUsername(verifyData.username);
      setSignedInLabel(label);
      setAvatarUrl(fetchedAvatarUrl);
      await setupDevice(token);
      setUnlocked(true);
    } catch (err) {
      console.warn("[webauthn] biometric unlock did not complete:", err);
    } finally {
      setBiometricBusy(false);
    }
  }

  // Registers this browser's platform authenticator (Face ID / Touch ID /
  // Windows Hello) as a way to unlock without typing the access code next
  // time. Requires the code once, up front - see app/api/webauthn/register-options.
  async function handleEnableBiometric() {
    playTap();
    setRegisteringDevice(true);
    setDeviceSetupMessage(null);

    const saved = loadSession();
    if (!saved) {
      setRegisteringDevice(false);
      return;
    }

    try {
      const optsRes = await fetch("/api/webauthn/register-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saved),
      });
      const optsData = (await optsRes.json().catch(() => ({}))) as {
        options?: Parameters<typeof startRegistration>[0]["optionsJSON"];
        error?: string;
      };
      if (!optsRes.ok || !optsData.options) throw new Error(optsData.error || "Could not start setup.");

      const attestation = await startRegistration({ optionsJSON: optsData.options });

      const verifyRes = await fetch("/api/webauthn/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...saved,
          response: attestation,
          expectedChallenge: optsData.options.challenge,
          deviceLabel: guessDeviceLabel(),
        }),
      });
      const verifyData = (await verifyRes.json().catch(() => ({}))) as {
        verified?: boolean;
        devices?: PublicCredentialInfo[];
        error?: string;
      };
      if (!verifyRes.ok || !verifyData.verified) throw new Error(verifyData.error || "Could not complete setup.");

      setDevices(verifyData.devices ?? []);
      setDeviceSetupMessage("Enabled on this device.");
    } catch (err) {
      setDeviceSetupMessage(err instanceof Error ? err.message : "Could not enable Face ID / Touch ID.");
    } finally {
      setRegisteringDevice(false);
    }
  }

  async function handleRemoveDevice(id: string, label: string) {
    if (!window.confirm(`Remove Face ID / Touch ID access for "${label}"?`)) return;
    playTap();
    const saved = loadSession();
    if (!saved) return;
    try {
      const res = await fetch("/api/webauthn/devices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saved, id }),
      });
      const data = (await res.json().catch(() => ({}))) as { devices?: PublicCredentialInfo[] };
      if (res.ok && data.devices) setDevices(data.devices);
    } catch {
      // Best-effort; the list simply reflects whatever's on the server next time it loads.
    }
  }

  async function handleAvatarFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same file be picked again later
    if (!file) return;
    playTap();
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      const saved = loadSession();
      if (!saved) throw new Error("Your session expired. Please sign out and sign in again.");
      const dataUrl = await resizeImageToDataUrl(file, 256);
      const res = await fetch("/api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saved, image: dataUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as { avatarUrl?: string; error?: string };
      if (!res.ok || !data.avatarUrl) throw new Error(data.error || "Could not upload photo.");
      setAvatarUrl(data.avatarUrl);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Could not upload photo.");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleChoosePreset(index: number) {
    playTap();
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      const saved = loadSession();
      if (!saved) throw new Error("Your session expired. Please sign out and sign in again.");
      const res = await fetch("/api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saved, preset: index }),
      });
      const data = (await res.json().catch(() => ({}))) as { avatarUrl?: string; error?: string };
      if (!res.ok || !data.avatarUrl) throw new Error(data.error || "Could not set avatar.");
      setAvatarUrl(data.avatarUrl);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Could not set avatar.");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleRemoveAvatar() {
    playTap();
    const saved = loadSession();
    if (!saved) return;
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      await fetch("/api/avatar", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saved),
      });
      setAvatarUrl(undefined);
    } catch {
      setAvatarError("Could not remove photo.");
    } finally {
      setAvatarUploading(false);
    }
  }

  // Deletes one call history entry - calls Twilio's own delete on the Call
  // resource, so it's a real, permanent removal from Twilio's records (not
  // just hidden here), same as message/conversation deletion.
  async function handleDeleteCall(sid: string) {
    if (!window.confirm("Delete this call from your history? This permanently removes it from Twilio's records and can't be undone.")) {
      return;
    }
    playTap();
    const saved = loadSession();
    if (!saved) return;
    try {
      await fetch("/api/calls", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saved, sid }),
      });
    } catch {
      // Best-effort; the refresh below shows whatever Twilio actually has.
    }
    await fetchCallLog();
  }

  // Appends a digit to the number being typed in the "new call" overlay -
  // distinct from handleKeypadPress, which sends DTMF tones into an
  // already-connected call instead. Tapping "0" as the very first
  // character types "+" instead (shown as the hint under 0) - a real
  // number never starts with a plain 0, so this is what a tap there
  // actually means in that position, same as a real phone dialer.
  function handleDialPadDigit(digit: string) {
    playTap();
    setPhoneNumber((p) => (digit === "0" && p === "" ? "+" : p + digit));
  }

  function handleBackspace() {
    playTap();
    setPhoneNumber((p) => p.slice(0, -1));
    setPhoneError(null);
  }

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
      const username = usernameInput.trim();
      const { token, phoneNumber, label, avatarUrl: fetchedAvatarUrl } = await requestToken(username, passwordInput);
      saveSession(username, passwordInput);
      setCallerId(phoneNumber);
      setSignedInUsername(username);
      setSignedInLabel(label);
      setAvatarUrl(fetchedAvatarUrl);
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
    clearSession();
    setUnlocked(false);
    setDeviceReady(false);
    setUsernameInput("");
    setPasswordInput("");
    setCallerId("");
    setSignedInUsername("");
    setSignedInLabel("");
    setAvatarUrl(undefined);
    setAvatarError(null);
    setProfileOpen(false);
    setActiveTab("calls");
    setCallLog([]);
    setDialOverlayOpen(false);
    setPhoneNumber("");
    setInputDevices([]);
    setOutputDevices([]);
    setMessageTo("");
    setActiveThread(null);
    setMessageBody("");
    setSmsError(null);
    setContacts([]);
    setDevices([]);
    setDeviceSetupMessage(null);
    resetAfterCall();
  }

  // Shared by the phone number form and by clicking "Call" on a phone book
  // entry, so both paths get the same validation and state transitions.
  async function dialNumber(rawNumber: string) {
    playTap();
    setCallError(null);
    setPhoneError(null);
    setDialOverlayOpen(true);

    const normalized = normalizePhoneNumber(rawNumber);
    if (!isValidE164(normalized)) {
      setPhoneError("Enter the number in international format, e.g. +12065551234");
      return;
    }

    setPhoneNumber(normalized);

    if (callStatus !== "ready" || !deviceRef.current || micPermission !== "granted") return;

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

  async function handleCall(e: React.FormEvent) {
    e.preventDefault();
    await dialNumber(phoneNumber);
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

  async function handleAddContact(e: React.FormEvent) {
    e.preventDefault();
    playTap();
    setContactFormError(null);

    const name = newContactName.trim();
    const normalized = normalizePhoneNumber(newContactNumber);

    if (!name) {
      setContactFormError("Enter a name.");
      return;
    }
    if (!isValidE164(normalized)) {
      setContactFormError("Enter the number in international format, e.g. +12065551234");
      return;
    }

    const next = [...contacts, { id: crypto.randomUUID(), name, number: normalized }];
    setContacts(next);
    setNewContactName("");
    setNewContactNumber("");
    setNewContactOpen(false);

    const ok = await saveContactsToServer(next);
    if (!ok) {
      setContactFormError("Could not save the contact. Please try again.");
      await fetchContacts();
    }
  }

  async function handleDeleteContact(id: string) {
    const next = contacts.filter((c) => c.id !== id);
    setContacts(next);

    const ok = await saveContactsToServer(next);
    if (!ok) await fetchContacts();
  }

  // Confirms the number typed into the "new message" box and opens it as a
  // thread - the only way a typed number becomes active, so nothing happens
  // while the user is still mid-keystroke.
  function handleOpenThread(e: React.FormEvent) {
    e.preventDefault();
    playTap();
    setSmsError(null);

    const normalized = normalizePhoneNumber(messageTo);
    if (!isValidE164(normalized)) {
      setSmsError("Enter the number in international format, e.g. +12065551234");
      return;
    }
    setMessageTo(normalized);
    setNewMessageOpen(false);
    setActiveThread(normalized);
  }

  // Sends optimistically, like a messaging app: the message appears in the
  // chat and the box clears immediately, then the real record replaces it
  // once Twilio has it. If the send fails, the text goes back in the box so
  // nothing typed is lost.
  async function handleSendMessage(e: React.FormEvent) {
    stickToBottomRef.current = true;
    e.preventDefault();
    playTap();
    setSmsError(null);

    if (!activeThread) return;
    const body = messageBody.trim();
    if (!body) return;

    const saved = loadSession();
    if (!saved) {
      setSmsError("Your session expired. Please sign out and sign in again.");
      return;
    }

    const thread = activeThread;
    const tempSid = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setPendingMessages((p) => [...p, { sid: tempSid, direction: "outbound", body, status: "sending", at: Date.now() }]);
    setMessageBody("");

    try {
      const res = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saved, to: thread, message: body }),
      });
      const data = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; error?: string };
      if (!res.ok || !data.sid) {
        throw new Error(data.error || "Failed to send message.");
      }
      // Pull the thread again immediately rather than waiting for the next
      // poll tick, so the real record replaces the placeholder right away.
      await fetchThread(thread);
    } catch (err) {
      setSmsError(err instanceof Error ? err.message : "Failed to send message.");
      setMessageBody((current) => current || body);
    } finally {
      setPendingMessages((p) => p.filter((m) => m.sid !== tempSid));
    }
  }

  // Deleting a message calls Twilio's own delete - it's permanently removed
  // from Twilio's records, not just hidden here, so both of these confirm
  // before doing anything irreversible.
  async function handleDeleteMessage(sid: string) {
    if (!activeThread) return;
    if (!window.confirm("Delete this message? This permanently removes it from Twilio's records and can't be undone.")) {
      return;
    }
    playTap();
    const saved = loadSession();
    if (!saved) return;
    try {
      await fetch("/api/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saved, sid }),
      });
    } catch {
      // Best-effort; the refresh below shows whatever Twilio actually has.
    }
    await fetchThread(activeThread);
  }

  async function handleDeleteConversation(number: string) {
    const label = contacts.find((c) => c.number === number)?.name ?? number;
    if (
      !window.confirm(
        `Delete the entire conversation with ${label}? This permanently removes every message with this number from Twilio's records and can't be undone.`,
      )
    ) {
      return;
    }
    playTap();
    const saved = loadSession();
    if (!saved) return;
    try {
      await fetch("/api/conversations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saved, with: number }),
      });
    } catch {
      // Best-effort; the refresh below shows whatever Twilio actually has.
    }
    if (activeThread === number) {
      setMessageTo("");
      setActiveThread(null);
    }
    await fetchConversations();
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

  // Defined once and reused in two places: the desktop side column and the
  // mobile drawer (see the bottom of the unlocked return below). Function
  // declarations above (dialNumber, handleAddContact, etc.) are hoisted, so
  // referencing them here before their textual definition is fine - what
  // matters is that this sits after all the state/hooks it reads.
  const filteredCalls = callLog.filter((entry) => {
    const q = callsSearch.trim().toLowerCase();
    if (!q) return true;
    const name = contacts.find((ct) => ct.number === entry.with)?.name ?? "";
    return name.toLowerCase().includes(q) || entry.with.includes(q);
  });

  const filteredConversations = conversations.filter((c) => {
    const q = textsSearch.trim().toLowerCase();
    if (!q) return true;
    const name = contacts.find((ct) => ct.number === c.number)?.name ?? "";
    return name.toLowerCase().includes(q) || c.number.includes(q) || c.lastBody.toLowerCase().includes(q);
  });

  const filteredContacts = contacts.filter((c) => {
    const q = contactsSearch.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.number.includes(q);
  });

  function openDialOverlay() {
    playTap();
    setCallError(null);
    setPhoneError(null);
    setPhoneNumber("");
    setDialOverlayOpen(true);
  }

  const callsTabBody = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-wide text-slate-900 dark:text-white">Calls</h1>
        {callLogLoading && <span className="text-[10px] text-slate-400 dark:text-slate-500">syncing…</span>}
      </div>
      <div className="relative mt-3">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={callsSearch}
          onChange={(e) => setCallsSearch(e.target.value)}
          placeholder="Search calls"
          className={`${COMPACT_INPUT_CLASS} pl-9`}
          aria-label="Search calls"
        />
      </div>
      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pb-24 lg:pb-4">
        {!callLogLoading && filteredCalls.length === 0 && (
          <p className="p-4 text-center text-sm text-slate-400 dark:text-slate-500">
            {callLog.length === 0 ? "No calls yet. Tap the button below to make one." : "No calls match your search."}
          </p>
        )}
        {filteredCalls.map((entry, i) => {
          const name = contacts.find((ct) => ct.number === entry.with)?.name;
          const missed = MISSED_STATUSES.has(entry.status);
          return (
            <div key={entry.sid} className={`${LIST_ROW_CLASS} ${ROW_ENTRANCE_CLASS}`} style={staggerStyle(i)}>
              <button type="button" onClick={() => dialNumber(entry.with)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <Avatar label={name ?? entry.with} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-slate-800 dark:text-slate-100">{name ?? entry.with}</p>
                  <p className={`flex items-center gap-1 truncate text-[13px] ${missed ? "text-[#C0272D]" : "text-slate-500 dark:text-slate-400"}`}>
                    {entry.direction === "inbound" ? (
                      <ArrowDownRightIcon className="h-3 w-3 shrink-0" />
                    ) : (
                      <ArrowUpRightIcon className="h-3 w-3 shrink-0" />
                    )}
                    {callStatusLabel(entry)}
                  </p>
                </div>
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="text-[11px] text-slate-400 dark:text-slate-500">{relativeDay(entry.at)}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      playTap();
                      setMessageTo(entry.with);
                      setActiveThread(entry.with);
                      setActiveTab("texts");
                    }}
                    className={MINI_ICON_BUTTON_CLASS}
                    aria-label={`Message ${name ?? entry.with}`}
                  >
                    <MessageIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCall(entry.sid)}
                    className={MINI_ICON_BUTTON_CLASS}
                    aria-label="Delete call"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // A message you sent that the server hasn't listed yet - hidden as soon as
  // the real record shows up, so it never appears twice.
  const visiblePending = pendingMessages.filter(
    (p) => !messageLog.some((m) => m.direction === "outbound" && m.body === p.body && m.at >= p.at - 10000),
  );
  const chatMessages = [...messageLog, ...visiblePending];
  const selectedMessage = selectedMessageSid ? chatMessages.find((m) => m.sid === selectedMessageSid) : undefined;

  function closeChat() {
    playTap();
    setMessageTo("");
    setActiveThread(null);
    setSmsError(null);
    setSelectedMessageSid(null);
  }

  // The open conversation. On a phone it is a full-screen chat pinned to the
  // visible viewport (so the keyboard never covers or shoves it, and nothing
  // zooms); on desktop the same view sits inside the Texts panel. Rendered
  // in exactly one place depending on screen size, never both.
  const chatView = activeThread ? (
    <div
      className={
        isDesktop
          ? "flex h-full min-h-0 flex-1 flex-col"
          : "fixed inset-x-0 z-40 flex flex-col overflow-hidden bg-gradient-to-br from-[#F7F2F1] via-white to-[#F5EFEE] animate-[chat-in_0.22s_ease-out] dark:from-[#0c0d10] dark:via-[#120a0b] dark:to-black"
      }
      style={isDesktop ? undefined : { top: vv?.top ?? 0, height: vv?.height ?? "100dvh" }}
    >
      {selectedMessage ? (
        <header className="flex shrink-0 items-center gap-1 border-b border-slate-900/5 pb-2 pl-1 pr-2 md:max-lg:px-[max(0.5rem,calc((100%-44rem)/2))] pt-[max(0.5rem,env(safe-area-inset-top))] animate-[fade-in_0.15s_ease-out] dark:border-white/5 lg:pt-0">
          <button
            type="button"
            onClick={() => setSelectedMessageSid(null)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-all active:scale-90 active:bg-slate-900/5 dark:text-slate-300 dark:active:bg-white/10"
            aria-label="Cancel selection"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
          <p className="flex-1 pl-1 text-base font-semibold text-slate-900 dark:text-white">1 selected</p>
          <button
            type="button"
            onClick={() => {
              playTap();
              void navigator.clipboard?.writeText(selectedMessage.body).catch(() => {});
              setSelectedMessageSid(null);
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition-all active:scale-90 active:bg-slate-900/5 dark:text-slate-300 dark:active:bg-white/10"
            aria-label="Copy message"
          >
            <CopyIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              const sid = selectedMessage.sid;
              setSelectedMessageSid(null);
              void handleDeleteMessage(sid);
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#C0272D] transition-all active:scale-90 active:bg-[#C0272D]/10"
            aria-label="Delete message"
          >
            <TrashIcon className="h-5 w-5" />
          </button>
        </header>
      ) : (
      <header className="flex shrink-0 items-center gap-1.5 border-b border-slate-900/5 pb-2 pl-1 pr-2 md:max-lg:px-[max(0.5rem,calc((100%-44rem)/2))] pt-[max(0.5rem,env(safe-area-inset-top))] dark:border-white/5 lg:pt-0">
        <button
          type="button"
          onClick={closeChat}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-all active:scale-90 active:bg-slate-900/5 dark:text-slate-300 dark:active:bg-white/10"
          aria-label="Back to conversations"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <Avatar label={threadContactName ?? activeThread} size="md" />
        <div className="min-w-0 flex-1 pl-1">
          <p className="truncate text-base font-semibold leading-tight text-slate-900 dark:text-white">
            {threadContactName ?? activeThread}
          </p>
          <p className="truncate text-[11px] leading-tight text-slate-500 dark:text-slate-400">
            {messagesLoading ? "syncing…" : threadContactName ? activeThread : "Text message"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => dialNumber(activeThread)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-all active:scale-90 active:bg-slate-900/5 dark:text-slate-300 dark:active:bg-white/10"
          aria-label={`Call ${threadContactName ?? activeThread}`}
        >
          <PhoneIcon className="h-5 w-5" />
        </button>
      </header>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={threadScrollRef}
        onClick={() => setSelectedMessageSid(null)}
        onScroll={handleThreadScroll}
        className="chat-wallpaper min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 md:max-lg:px-[max(0.75rem,calc((100%-44rem)/2))] lg:my-2 lg:rounded-2xl lg:border lg:border-white/40 lg:bg-white/20 dark:lg:border-white/5 dark:lg:bg-black/10"
      >
        {chatMessages.length === 0 && !messagesLoading && (
          <div className="mt-8 flex justify-center px-4">
            <p className="rounded-2xl bg-white/90 px-4 py-2 text-center text-xs leading-relaxed text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.12)] dark:bg-white/10 dark:text-slate-300">
              No messages yet. Send the first one below - it goes out as a text message.
            </p>
          </div>
        )}
        {chatMessages.map((m, i) => {
          const prev = chatMessages[i - 1];
          const showDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
          const out = m.direction === "outbound";
          const grouped = !showDay && prev && prev.direction === m.direction;
          const isPending = m.sid.startsWith("pending-");
          const selected = selectedMessageSid === m.sid;
          return (
            <div key={m.sid}>
              {showDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-slate-900/5 px-3 py-1 text-[11px] font-medium text-slate-500 dark:bg-white/10 dark:text-slate-300">
                    {dayLabel(m.at)}
                  </span>
                </div>
              )}
              <div className={`flex ${out ? "justify-end" : "justify-start"} ${grouped ? "mt-0.5" : "mt-2.5"}`}>
                <div className={`flex min-w-0 max-w-[82%] flex-col lg:max-w-[70%] ${out ? "items-end" : "items-start"}`}>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isPending) setSelectedMessageSid(selected ? null : m.sid);
                    }}
                    className={`relative px-3 py-1.5 text-[15px] leading-snug shadow-[0_1px_1.5px_rgba(15,23,42,0.14)] ${
                      out
                        ? `rounded-2xl bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white ${grouped ? "" : "bubble-tail-out rounded-tr-none"}`
                        : `rounded-2xl bg-white text-slate-800 dark:bg-[#26272c] dark:text-slate-100 ${grouped ? "" : "bubble-tail-in rounded-tl-none"}`
                    } ${selected ? "outline outline-2 outline-offset-2 outline-[#C0272D]/50" : ""}`}
                  >
                    {/* The time floats to the end of the last line (WhatsApp
                        style), so short messages stay one compact bubble. */}
                    <p className="flow-root whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {linkify(m.body)}
                      <span
                        className={`float-right ml-2.5 mt-[7px] inline-flex select-none items-center gap-1 text-[10px] leading-none ${out ? "text-white/75" : "text-slate-400"}`}
                      >
                        <span>{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        {out && <MessageTicks status={m.status} />}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {scrolledUp && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 right-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/95 text-slate-600 shadow-[0_8px_20px_-6px_rgba(15,23,42,0.35)] transition-all animate-[pop-in_0.18s_ease-out] active:scale-90 dark:border-white/10 dark:bg-[#1b1c20] dark:text-slate-200"
          aria-label="Jump to latest message"
        >
          <ChevronDownIcon className="h-5 w-5" />
        </button>
      )}
      </div>

      <div className="shrink-0 border-t border-slate-900/5 px-2 md:max-lg:px-[max(0.5rem,calc((100%-44rem)/2))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 dark:border-white/5 lg:border-0 lg:px-0 lg:pb-0">
        {smsError && <p className={`px-2 pb-1.5 ${COMPACT_ERROR_CLASS}`}>{smsError}</p>}
        <form onSubmit={handleSendMessage} className="flex items-end gap-2">
          <div className="relative min-w-0 flex-1">
            <textarea
              ref={composerRef}
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends on a computer; on a phone it's a new line, since
                // the on-screen keyboard has no Shift.
                if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              maxLength={MAX_SMS_LENGTH}
              placeholder="Message"
              className="block max-h-[120px] min-h-[44px] w-full resize-none rounded-3xl border border-slate-900/10 bg-white/90 px-4 py-[10px] text-base leading-snug text-slate-900 shadow-[inset_0_1px_3px_rgba(15,23,42,0.06)] outline-none placeholder:text-slate-400 focus:border-[#C0272D]/40 dark:border-white/10 dark:bg-white/10 dark:text-slate-50 dark:placeholder:text-slate-500"
              aria-label="Message"
            />
            {messageBody.length > MAX_SMS_LENGTH - 200 && (
              <span className="pointer-events-none absolute -top-4 right-3 text-[10px] text-slate-400">
                {messageBody.length}/{MAX_SMS_LENGTH}
              </span>
            )}
          </div>
          <button
            type="submit"
            // Keeps the keyboard open after sending, so you can keep typing.
            onPointerDown={(e) => e.preventDefault()}
            disabled={!messageBody.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white shadow-[0_8px_18px_-8px_rgba(192,39,45,0.7)] transition-all active:scale-90 disabled:opacity-40 disabled:shadow-none"
            aria-label="Send"
          >
            <SendIcon className="h-5 w-5" />
          </button>
        </form>
      </div>
    </div>
  ) : null;

  const textsListBody = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2">
        <h1 className="truncate text-xl font-semibold tracking-wide text-slate-900 dark:text-white">Texts</h1>
        <button
          type="button"
          onClick={() => {
            playTap();
            setNewMessageOpen((open) => !open);
            setSmsError(null);
          }}
          aria-expanded={newMessageOpen}
          className={HEADER_PILL_CLASS}
        >
          <PlusIcon className={`h-3.5 w-3.5 transition-transform ${newMessageOpen ? "rotate-45" : ""}`} />
          New message
        </button>
      </div>

          {newMessageOpen && (
          <form onSubmit={handleOpenThread} className="mt-3 animate-[slide-fade-in_0.2s_ease-out]">
            <div className="flex gap-2">
              <input
                autoFocus
                type="tel"
                inputMode="tel"
                value={messageTo}
                onChange={(e) => {
                  setMessageTo(e.target.value);
                  setSmsError(null);
                }}
                placeholder="New message: +1 555 123 4567"
                className={`flex-1 ${COMPACT_INPUT_CLASS}`}
                aria-label="Message recipient"
              />
              <button type="submit" className={MINI_ICON_BUTTON_CLASS} aria-label="Open conversation">
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            {smsError && <p className={`mt-1.5 ${COMPACT_ERROR_CLASS}`}>{smsError}</p>}
          </form>
          )}
          <div className="relative mt-3">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={textsSearch}
              onChange={(e) => setTextsSearch(e.target.value)}
              placeholder="Search texts"
              className={`${COMPACT_INPUT_CLASS} pl-9`}
              aria-label="Search texts"
            />
          </div>
          <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pb-24 lg:pb-4">
            {conversationsLoading && conversations.length === 0 && (
              <p className="p-4 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</p>
            )}
            {!conversationsLoading && filteredConversations.length === 0 && (
              <p className="p-4 text-center text-sm text-slate-400 dark:text-slate-500">
                {conversations.length === 0 ? "No conversations yet." : "No conversations match your search."}
              </p>
            )}
            {filteredConversations.map((c, i) => {
              const name = contacts.find((ct) => ct.number === c.number)?.name;
              return (
                <div key={c.number} className={`${LIST_ROW_CLASS} ${ROW_ENTRANCE_CLASS}`} style={staggerStyle(i)}>
                  <button
                    type="button"
                    onClick={() => {
                      playTap();
                      setMessageTo(c.number);
                      setActiveThread(c.number);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <Avatar label={name ?? c.number} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-slate-800 dark:text-slate-100">{name ?? c.number}</p>
                      <p className="mt-0.5 truncate text-[13px] text-slate-500 dark:text-slate-400">
                        {c.lastDirection === "outbound" && <span className="text-slate-400 dark:text-slate-500">You: </span>}
                        {c.lastBody}
                      </p>
                    </div>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 self-stretch py-0.5">
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">{relativeDay(c.lastAt)}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteConversation(c.number)}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-slate-300 transition-all hover:bg-slate-900/5 hover:text-[#C0272D] active:scale-90 dark:text-slate-600 dark:hover:bg-white/10"
                      aria-label={`Delete conversation with ${name ?? c.number}`}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
    </div>
  );

  // Desktop shows the chat inside this panel; on a phone the chat is a
  // separate full-screen layer (see chatView above), so this stays the list.
  const textsTabBody = activeThread && isDesktop ? chatView : textsListBody;

  const contactsTabBody = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-wide text-slate-900 dark:text-white">Contacts</h1>
        <div className="flex items-center gap-2">
          {contactsLoading && <span className="text-[10px] text-slate-400 dark:text-slate-500">syncing…</span>}
          <button
            type="button"
            onClick={() => {
              playTap();
              setNewContactOpen((open) => !open);
              setContactFormError(null);
            }}
            aria-expanded={newContactOpen}
            className={HEADER_PILL_CLASS}
          >
            <PlusIcon className={`h-3.5 w-3.5 transition-transform ${newContactOpen ? "rotate-45" : ""}`} />
            New contact
          </button>
        </div>
      </div>
      {newContactOpen && (
        <form onSubmit={handleAddContact} className="mt-3 space-y-2 animate-[slide-fade-in_0.2s_ease-out]">
          <input
            autoFocus
            value={newContactName}
            onChange={(e) => setNewContactName(e.target.value)}
            placeholder="Name"
            className={COMPACT_INPUT_CLASS}
            aria-label="Contact name"
          />
          <input
            type="tel"
            inputMode="tel"
            value={newContactNumber}
            onChange={(e) => setNewContactNumber(e.target.value)}
            placeholder="+1 555 123 4567"
            className={COMPACT_INPUT_CLASS}
            aria-label="Contact number"
          />
          {contactFormError && <p className={COMPACT_ERROR_CLASS}>{contactFormError}</p>}
          <button type="submit" className={SMALL_BUTTON_CLASS}>
            Save contact
          </button>
        </form>
      )}
      <div className="relative mt-3">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={contactsSearch}
          onChange={(e) => setContactsSearch(e.target.value)}
          placeholder="Search contacts"
          className={`${COMPACT_INPUT_CLASS} pl-9`}
          aria-label="Search contacts"
        />
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pb-24 lg:pb-4">
        {filteredContacts.length === 0 && !contactsLoading && (
          <p className="p-4 text-center text-sm text-slate-400 dark:text-slate-500">
            {contacts.length === 0 ? "No saved contacts yet." : "No contacts match your search."}
          </p>
        )}
        {filteredContacts.map((c, i) => (
          <div key={c.id} className={`${LIST_ROW_CLASS} ${ROW_ENTRANCE_CLASS}`} style={staggerStyle(i)}>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar label={c.name} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-slate-800 dark:text-slate-100">{c.name}</p>
                <p className="mt-0.5 truncate text-[13px] text-slate-500 dark:text-slate-400">{c.number}</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                onClick={() => dialNumber(c.number)}
                className={MINI_ICON_BUTTON_CLASS}
                aria-label={`Call ${c.name}`}
              >
                <PhoneIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  playTap();
                  setMessageTo(c.number);
                  setActiveThread(c.number);
                  setActiveTab("texts");
                }}
                className={MINI_ICON_BUTTON_CLASS}
                aria-label={`Message ${c.name}`}
              >
                <MessageIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleDeleteContact(c.id)}
                className={MINI_ICON_BUTTON_CLASS}
                aria-label={`Delete ${c.name}`}
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if (checkingSession) {
    return (
      <Shell>
        <div className={CARD_CLASS}>
          <Logo />
          <p className="mt-4 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</p>
        </div>
      </Shell>
    );
  }

  if (!unlocked) {
    return (
      <Shell>
        <form onSubmit={handleUnlock} className={CARD_CLASS}>
          <Logo />
          <h1 className="mt-4 text-center text-lg font-semibold tracking-wide text-slate-900 dark:text-white">
            BUSINESS <span className="text-[#C0272D]">CALLER</span>
          </h1>
          <p className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">
            Sign in to continue
          </p>

          <label htmlFor="username" className="mt-6 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Username
          </label>
          <input
            id="username"
            type="text"
            autoComplete="username"
            value={usernameInput}
            onChange={(e) => {
              setUsernameInput(e.target.value);
              setLockError(null);
            }}
            className={INPUT_CLASS}
            placeholder="e.g. amar"
            required
          />

          {biometricSupported && (
            <>
              <button
                type="button"
                onClick={handleBiometricUnlock}
                disabled={biometricBusy || !usernameInput.trim()}
                className={`${PRIMARY_BUTTON_CLASS} mt-4 flex items-center justify-center gap-2`}
              >
                <FingerprintIcon className="h-4 w-4" />
                {biometricBusy ? "Verifying…" : "Unlock with Face ID / Touch ID"}
              </button>
              <div className="my-4 flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
                <div className="h-px flex-1 bg-slate-900/10 dark:bg-white/10" />
                or enter your password
                <div className="h-px flex-1 bg-slate-900/10 dark:bg-white/10" />
              </div>
            </>
          )}

          <label htmlFor="password" className={biometricSupported ? "block text-sm font-medium text-slate-700 dark:text-slate-300" : "mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300"}>
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
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

  const showCallOverlay = dialOverlayOpen || callStatus !== "ready";
  const overlayName = phoneNumber ? contacts.find((c) => c.number === phoneNumber)?.name : undefined;

  // The dial pad / active-call screen. Rendered twice: docked permanently
  // on the right on desktop (there's plenty of spare width there, so it's
  // always visible rather than hidden behind a button - see the aside
  // below), and as a dismissible modal on mobile, opened from the Calls
  // tab's FAB. `closable` only controls whether the pre-call screen shows
  // a close (X) button - the desktop dock can't be dismissed, so it has no
  // "New call" title/close row at all, just the calling-from pill onward.
  function callPanelBody(closable: boolean) {
    const ready = callStatus === "ready";
    return (
      <>
        {closable && ready && (
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-wide text-slate-900 dark:text-white">New call</h2>
            <button
              type="button"
              onClick={() => {
                playTap();
                setDialOverlayOpen(false);
                setCallError(null);
                setPhoneError(null);
              }}
              className={MINI_ICON_BUTTON_CLASS}
              aria-label="Close"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <p
          className={`${closable && ready ? "mt-1.5" : ""} inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-white/50 px-2.5 py-1 text-xs font-medium text-slate-500 backdrop-blur-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-400`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#C0272D]" />
          Calling from {callerId || "…"}
        </p>

        {/* Mic/speaker pickers - shown at all times, including mid-call, so
            switching from the earpiece/speaker to a Bluetooth headset (or
            back) doesn't require hanging up first. */}
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

        {ready ? (
          <form onSubmit={handleCall} className="mt-5">
            <input
              type="tel"
              inputMode="tel"
              value={phoneNumber}
              onChange={(e) => {
                setPhoneNumber(e.target.value);
                setPhoneError(null);
              }}
              className={`${INPUT_CLASS} mt-0 text-center text-lg tracking-wide`}
              placeholder="+1 555 123 4567"
              aria-label="Phone number"
            />
            {phoneError && <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{phoneError}</p>}

            {/* Live contact match, echoing a "suggestion" row - shows who
                this number belongs to before the call is even placed. */}
            {overlayName && (
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/50 bg-white/40 px-2.5 py-1.5 dark:border-white/5 dark:bg-white/[0.03]">
                <Avatar label={overlayName} size="sm" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{overlayName}</span>
              </div>
            )}

            <div className="mt-4 grid grid-cols-3 gap-x-2 gap-y-3">
              {KEYPAD_DIGITS.map(({ digit, letters }) => (
                <KeypadButton key={digit} digit={digit} letters={letters} onClick={() => handleDialPadDigit(digit)} />
              ))}
            </div>

            <div className="mt-6 grid grid-cols-3 items-center">
              <div />
              <button type="submit" disabled={!canCall} className={CALL_BUTTON_CIRCLE_CLASS} aria-label="Call">
                <PhoneIcon className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={handleBackspace}
                disabled={!phoneNumber}
                className={`${CALL_ACTION_CIRCLE_CLASS} mx-auto disabled:cursor-not-allowed disabled:opacity-30`}
                aria-label="Delete last digit"
              >
                <BackspaceIcon className="h-5 w-5" />
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="mt-5 flex flex-col items-center text-center">
              <Avatar label={overlayName ?? phoneNumber} size="xl" />
              <h2 className="mt-3 text-lg font-semibold tracking-wide text-slate-900 dark:text-white">
                {overlayName ?? phoneNumber}
              </h2>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    callStatus === "in-call"
                      ? "bg-emerald-500 shadow-[0_0_8px_2px_rgba(16,185,129,0.6)]"
                      : "animate-pulse bg-amber-500 shadow-[0_0_8px_2px_rgba(245,158,11,0.5)]"
                  }`}
                />
                {statusLabel}
              </p>
            </div>

            {callStatus === "in-call" && (
              <div className="mt-7 grid grid-cols-2 justify-items-center gap-x-6 gap-y-6">
                <div className="flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleToggleMute}
                    className={muted ? CALL_ACTION_CIRCLE_ACTIVE_CLASS : CALL_ACTION_CIRCLE_CLASS}
                    aria-label={muted ? "Unmute" : "Mute"}
                  >
                    <MicOffIcon className="h-5 w-5" />
                  </button>
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {muted ? "Muted" : "Mute"}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      playTap();
                      setKeypadOpen((v) => !v);
                    }}
                    className={keypadOpen ? CALL_ACTION_CIRCLE_ACTIVE_CLASS : CALL_ACTION_CIRCLE_CLASS}
                    aria-label="Keypad"
                  >
                    <KeypadIcon className="h-5 w-5" />
                  </button>
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Keypad</span>
                </div>

                {/* A single generic Hold only makes sense while there's at
                    most one other party - once a call has been added, hold
                    is per-participant (see the list below) since "hold" is
                    otherwise ambiguous about who to hold. */}
                {conferenceParticipants.length <= 1 && (
                  <div className="flex flex-col items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleToggleHold(conferenceParticipants[0]?.callSid, !conferenceParticipants[0]?.onHold)}
                      disabled={callActionBusy}
                      className={
                        conferenceParticipants[0]?.onHold ? CALL_ACTION_CIRCLE_ACTIVE_CLASS : CALL_ACTION_CIRCLE_CLASS
                      }
                      aria-label={conferenceParticipants[0]?.onHold ? "Resume" : "Hold"}
                    >
                      <PauseIcon className="h-5 w-5" />
                    </button>
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      {conferenceParticipants[0]?.onHold ? "On hold" : "Hold"}
                    </span>
                  </div>
                )}

                <div className="flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      playTap();
                      setCallActionError(null);
                      setAddCallOpen((v) => !v);
                    }}
                    className={addCallOpen ? CALL_ACTION_CIRCLE_ACTIVE_CLASS : CALL_ACTION_CIRCLE_CLASS}
                    aria-label="Add call"
                  >
                    <PersonPlusIcon className="h-5 w-5" />
                  </button>
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Add call</span>
                </div>

                {conferenceParticipants.some((p) => p.onHold) && (
                  <div className="flex flex-col items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleMerge}
                      disabled={callActionBusy}
                      className={CALL_ACTION_CIRCLE_CLASS}
                      aria-label="Merge"
                    >
                      <MergeIcon className="h-5 w-5" />
                    </button>
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Merge</span>
                  </div>
                )}
              </div>
            )}

            {callStatus === "in-call" && addCallOpen && (
              <form onSubmit={handleAddCallSubmit} className="mt-4 flex gap-2">
                <input
                  type="tel"
                  inputMode="tel"
                  autoFocus
                  value={addCallNumber}
                  onChange={(e) => setAddCallNumber(e.target.value)}
                  placeholder="+1 555 123 4567"
                  className={`flex-1 ${COMPACT_INPUT_CLASS}`}
                  aria-label="Number to add to this call"
                />
                <button type="submit" disabled={callActionBusy} className={MINI_ICON_BUTTON_CLASS} aria-label="Call">
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </button>
              </form>
            )}

            {callStatus === "in-call" && inConference && conferenceParticipants.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {conferenceParticipants.map((p) => {
                  const name = contacts.find((c) => c.number === p.number)?.name;
                  return (
                    <div
                      key={p.callSid}
                      className="flex items-center gap-2 rounded-xl border border-white/50 bg-white/40 px-2.5 py-1.5 dark:border-white/5 dark:bg-white/[0.03]"
                    >
                      <Avatar label={name ?? p.number} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                        {name ?? p.number}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggleHold(p.callSid, !p.onHold)}
                        disabled={callActionBusy}
                        className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-[#C0272D] disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400"
                      >
                        {p.onHold ? "Resume" : "Hold"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {callActionError && <p className={`mt-3 ${COMPACT_ERROR_CLASS}`}>{callActionError}</p>}

            {callStatus === "in-call" && keypadOpen && (
              <div className="mt-5 grid grid-cols-3 gap-x-2 gap-y-3">
                {KEYPAD_DIGITS.map(({ digit, letters }) => (
                  <KeypadButton key={digit} digit={digit} letters={letters} onClick={() => handleKeypadPress(digit)} />
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleHangUp}
              disabled={!canHangUp}
              className={`mt-8 ${HANGUP_CIRCLE_CLASS}`}
              aria-label="Hang up"
            >
              <PhoneIcon className="h-6 w-6 rotate-[135deg]" />
            </button>
          </>
        )}

        {ready && micPermission === "denied" && (
          <p className="mt-4 rounded-2xl border border-amber-200/60 bg-amber-50/80 px-3 py-2 text-sm text-amber-800 backdrop-blur-sm dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300">
            Microphone access is blocked. Allow microphone access for this site in your
            browser&apos;s settings, then reload the page.
          </p>
        )}

        {callError && <p className={`mt-4 ${ERROR_BANNER_CLASS}`}>{callError}</p>}
      </>
    );
  }

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-gradient-to-br from-[#F7F2F1] via-white to-[#F5EFEE] dark:from-[#0c0d10] dark:via-[#120a0b] dark:to-black">
      <div className="pointer-events-none absolute -left-24 -top-32 h-96 w-96 rounded-full bg-[#C0272D]/20 blur-[120px] dark:bg-[#C0272D]/25" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-[#C0272D]/10 blur-[120px] dark:bg-[#C0272D]/10" />

      {/* Desktop nav rail */}
      <nav className={NAV_RAIL_CLASS}>
        <button
          type="button"
          onClick={() => {
            playTap();
            setActiveTab("calls");
          }}
          className={activeTab === "calls" ? NAV_BUTTON_ACTIVE_CLASS : NAV_BUTTON_INACTIVE_CLASS}
        >
          <PhoneIcon className="h-5 w-5" />
          Calls
        </button>
        <button
          type="button"
          onClick={() => {
            playTap();
            setActiveTab("texts");
          }}
          className={activeTab === "texts" ? NAV_BUTTON_ACTIVE_CLASS : NAV_BUTTON_INACTIVE_CLASS}
        >
          <MessageIcon className="h-5 w-5" />
          Texts
        </button>
        <button
          type="button"
          onClick={() => {
            playTap();
            setActiveTab("contacts");
          }}
          className={activeTab === "contacts" ? NAV_BUTTON_ACTIVE_CLASS : NAV_BUTTON_INACTIVE_CLASS}
        >
          <PeopleIcon className="h-5 w-5" />
          Contacts
        </button>
        <div className="mt-auto flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => {
              playTap();
              setProfileOpen(true);
            }}
            aria-label="Profile and settings"
          >
            <Avatar label={signedInLabel || signedInUsername} photoUrl={avatarUrl} size="lg" />
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4 lg:hidden">
          <Image src="/ethixweb-logo.png" alt="Ethixweb" width={120} height={20} className="h-4 w-auto dark:invert" />
          <button
            type="button"
            onClick={() => {
              playTap();
              setProfileOpen(true);
            }}
            aria-label="Profile and settings"
          >
            <Avatar label={signedInLabel || signedInUsername} photoUrl={avatarUrl} size="md" />
          </button>
        </div>

        <div className="hidden items-center px-8 pb-1 pt-6 lg:flex">
          <Image src="/ethixweb-logo.png" alt="Ethixweb" width={160} height={24} className="h-6 w-auto dark:invert" />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4 lg:px-8 lg:py-6">
          <div className={MAIN_PANEL_CLASS}>
            <div key={activeTab} className="flex h-full min-h-0 flex-1 flex-col animate-[slide-fade-in_0.25s_ease-out]">
              {activeTab === "calls" && callsTabBody}
              {activeTab === "texts" && textsTabBody}
              {activeTab === "contacts" && contactsTabBody}
            </div>
          </div>
        </div>

        {activeTab === "calls" && (
          <button type="button" onClick={openDialOverlay} className={`${FAB_CLASS} lg:hidden`} aria-label="New call">
            <PhoneIcon className="h-5 w-5" />
          </button>
        )}
      </main>

      {/* Desktop dial pad - docked permanently on the right rather than
          hidden behind a button, since there's ample spare width there. */}
      {/* Fixed top padding rather than lg:justify-center - centering a
          flex item inside an overflow-y-auto container can make its top
          become unreachable by scroll in some browsers if the content ever
          grows taller than the viewport (e.g. an active call with every
          device picker and the DTMF pad open on a short laptop screen). */}
      <aside className="hidden lg:flex lg:h-dvh lg:w-[360px] lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:border-l lg:border-white/50 lg:bg-white/60 lg:px-6 lg:pb-6 lg:pt-16 lg:backdrop-blur-2xl lg:backdrop-saturate-150 dark:lg:border-white/10 dark:lg:bg-white/[0.04]">
        {callPanelBody(false)}
      </aside>

      {/* Mobile bottom tab bar */}
      <nav className={BOTTOM_BAR_CLASS}>
        <button
          type="button"
          onClick={() => {
            playTap();
            setActiveTab("calls");
          }}
          className={activeTab === "calls" ? NAV_BUTTON_ACTIVE_CLASS : NAV_BUTTON_INACTIVE_CLASS}
        >
          <PhoneIcon className="h-5 w-5" />
          Calls
        </button>
        <button
          type="button"
          onClick={() => {
            playTap();
            setActiveTab("texts");
          }}
          className={activeTab === "texts" ? NAV_BUTTON_ACTIVE_CLASS : NAV_BUTTON_INACTIVE_CLASS}
        >
          <MessageIcon className="h-5 w-5" />
          Texts
        </button>
        <button
          type="button"
          onClick={() => {
            playTap();
            setActiveTab("contacts");
          }}
          className={activeTab === "contacts" ? NAV_BUTTON_ACTIVE_CLASS : NAV_BUTTON_INACTIVE_CLASS}
        >
          <PeopleIcon className="h-5 w-5" />
          Contacts
        </button>
      </nav>

      {/* Phone: the open chat is a full-screen layer over everything, including
          the bottom tab bar (as in a messaging app). Sits below the call overlay
          so tapping Call from a chat still opens the dialer on top. */}
      {!isDesktop && activeTab === "texts" && chatView}

      {/* Mobile-only call overlay - open on demand from the Calls tab's
          FAB, and forced open for the whole lifetime of an active call
          regardless of how it was started (FAB, contact, call-log redial).
          Desktop doesn't need this - the aside above is always visible. */}
      {showCallOverlay && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-[fade-in_0.2s_ease-out] lg:hidden">
          <div className={`${CARD_CLASS} max-h-[calc(100dvh-2rem)] overflow-y-auto animate-[pop-in_0.25s_cubic-bezier(0.16,1,0.3,1)]`}>
            {callPanelBody(true)}
          </div>
        </div>
      )}


      {/* Profile panel */}
      {profileOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-[fade-in_0.2s_ease-out]">
          <div className={`${CARD_CLASS} max-h-[calc(100dvh-2rem)] overflow-y-auto animate-[pop-in_0.25s_cubic-bezier(0.16,1,0.3,1)]`}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-wide text-slate-900 dark:text-white">Profile</h2>
              <button type="button" onClick={() => setProfileOpen(false)} className={MINI_ICON_BUTTON_CLASS} aria-label="Close">
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-4 flex flex-col items-center">
              <div className="relative">
                <Avatar label={signedInLabel || signedInUsername} photoUrl={avatarUrl} size="xl" />
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-b from-slate-800 to-slate-950 text-white shadow-[0_6px_16px_-6px_rgba(15,23,42,0.6)] transition-all hover:brightness-110 active:scale-90 disabled:opacity-50 dark:from-white dark:to-slate-100 dark:text-slate-900"
                  aria-label="Change photo"
                >
                  <CameraIcon className="h-3.5 w-3.5" />
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleAvatarFileChange}
                  className="hidden"
                />
              </div>
              <p className="mt-3 text-base font-medium text-slate-900 dark:text-white">{signedInLabel || signedInUsername}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{callerId}</p>
              {avatarUploading && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Uploading…</p>}
              {avatarError && <p className={`mt-1 ${COMPACT_ERROR_CLASS}`}>{avatarError}</p>}
              {avatarUrl && !avatarUploading && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  className="mt-1 text-xs font-medium text-[#C0272D] hover:underline"
                >
                  Remove photo
                </button>
              )}

              <p className="mt-4 text-xs font-medium text-slate-500 dark:text-slate-400">Or pick an avatar</p>
              {/* Wraps (rather than relying on exact-fit math) so the glow
                  rings never spill past the card's rounded edge on narrow
                  screens, where this card is well under max-w-sm wide. */}
              <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-2 px-2">
                {Array.from({ length: PRESET_COUNT }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleChoosePreset(i)}
                    disabled={avatarUploading}
                    className={`shrink-0 rounded-full transition-all active:scale-90 disabled:opacity-50 ${
                      avatarUrl === `preset:${i}` ? "ring-2 ring-[#C0272D] ring-offset-2 ring-offset-white dark:ring-offset-[#0c0d10]" : ""
                    }`}
                    aria-label={`Preset avatar ${i + 1}`}
                  >
                    <Avatar label="" photoUrl={`preset:${i}`} size="md" />
                  </button>
                ))}
              </div>
            </div>

            {biometricSupported && (
              <div className="mt-5 border-t border-slate-900/5 pt-4 dark:border-white/5">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <FingerprintIcon className="h-3.5 w-3.5" />
                    Face ID / Touch ID
                  </p>
                  <button
                    type="button"
                    onClick={handleEnableBiometric}
                    disabled={registeringDevice}
                    className="text-xs font-medium text-[#C0272D] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {registeringDevice ? "Adding…" : "+ Add this device"}
                  </button>
                </div>
                {deviceSetupMessage && (
                  <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">{deviceSetupMessage}</p>
                )}
                {devices.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {devices.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between rounded-lg bg-slate-900/5 px-2.5 py-1.5 text-xs dark:bg-white/5"
                      >
                        <span className="truncate text-slate-600 dark:text-slate-300">{d.deviceLabel}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveDevice(d.id, d.deviceLabel)}
                          className="shrink-0 text-slate-400 transition-colors hover:text-[#C0272D]"
                          aria-label={`Remove ${d.deviceLabel}`}
                        >
                          <TrashIcon className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handleSignOut}
              disabled={canHangUp}
              className={`${SMALL_BUTTON_CLASS} mt-5 !bg-none !bg-transparent !text-[#C0272D] !shadow-none disabled:cursor-not-allowed disabled:opacity-40`}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
