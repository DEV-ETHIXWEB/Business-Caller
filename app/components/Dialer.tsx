"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  "mx-auto flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-full border border-white/60 bg-white/50 font-medium text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_14px_28px_-10px_rgba(15,23,42,0.4),0_4px_10px_-4px_rgba(15,23,42,0.2)] backdrop-blur-sm transition-all duration-150 hover:bg-white/80 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_18px_32px_-10px_rgba(192,39,45,0.3),0_6px_14px_-4px_rgba(192,39,45,0.2)] active:scale-90 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_14px_28px_-10px_rgba(0,0,0,0.7),0_4px_10px_-4px_rgba(0,0,0,0.5)] dark:hover:bg-white/10";

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

  // Contacts are stored server-side (see app/api/contacts/route.ts) so the
  // same Phone Book shows up on every device, not just whichever browser
  // added a contact - fetched once unlocked, below.
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactNumber, setNewContactNumber] = useState("");
  const [contactFormError, setContactFormError] = useState<string | null>(null);

  const [messageTo, setMessageTo] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
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

  // Keep the conversation pinned to the latest message as new ones arrive
  // from polling or are sent.
  useEffect(() => {
    const el = threadScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messageLog]);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

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
    setDialOverlayOpen(false);
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
    setActiveThread(normalized);
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    playTap();
    setSmsError(null);

    if (!activeThread) return;
    const body = messageBody.trim();
    if (!body) {
      setSmsError("Message cannot be empty.");
      return;
    }

    const saved = loadSession();
    if (!saved) {
      setSmsError("Your session expired. Please sign out and sign in again.");
      return;
    }

    setSendingMessage(true);
    try {
      const res = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...saved, to: activeThread, message: body }),
      });
      const data = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; error?: string };
      if (!res.ok || !data.sid) {
        throw new Error(data.error || "Failed to send message.");
      }
      setMessageBody("");
      // Pull the thread again immediately rather than waiting for the next
      // poll tick, so the just-sent message appears right away.
      await fetchThread(activeThread);
    } catch (err) {
      setSmsError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSendingMessage(false);
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
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{name ?? entry.with}</p>
                  <p className={`flex items-center gap-1 truncate text-xs ${missed ? "text-[#C0272D]" : "text-slate-400 dark:text-slate-500"}`}>
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
                <span className="text-[10px] text-slate-400 dark:text-slate-500">{relativeDay(entry.at)}</span>
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

  const textsTabBody = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2">
        {activeThread && (
          <button
            type="button"
            onClick={() => {
              playTap();
              setMessageTo("");
              setActiveThread(null);
              setSmsError(null);
            }}
            className={MINI_ICON_BUTTON_CLASS}
            aria-label="Back to conversations"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
          </button>
        )}
        <h1 className="truncate text-xl font-semibold tracking-wide text-slate-900 dark:text-white">
          {activeThread ? (threadContactName ?? activeThread) : "Texts"}
        </h1>
        {activeThread && messagesLoading && (
          <span className="ml-auto shrink-0 text-[10px] text-slate-400 dark:text-slate-500">syncing…</span>
        )}
      </div>

      {!activeThread ? (
        <>
          <form onSubmit={handleOpenThread} className="mt-3">
            <div className="flex gap-2">
              <input
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
                      <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{name ?? c.number}</p>
                      <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                        {c.lastDirection === "outbound" ? "You: " : ""}
                        {c.lastBody}
                      </p>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">{relativeDay(c.lastAt)}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteConversation(c.number)}
                      className={MINI_ICON_BUTTON_CLASS}
                      aria-label={`Delete conversation with ${name ?? c.number}`}
                    >
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div
            ref={threadScrollRef}
            className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl border border-white/40 bg-white/20 p-3 dark:border-white/5 dark:bg-black/10"
          >
            {messageLog.length === 0 && !messagesLoading && (
              <p className="p-2 text-center text-xs text-slate-400 dark:text-slate-500">No messages yet.</p>
            )}
            {messageLog.map((m) => (
              <div key={m.sid} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-1.5 text-xs ${
                    m.direction === "outbound"
                      ? "bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white"
                      : "border border-white/60 bg-white/80 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-200"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <div
                    className={`mt-0.5 flex items-center gap-1.5 text-[10px] ${m.direction === "outbound" ? "text-white/70" : "text-slate-400 dark:text-slate-500"}`}
                  >
                    <span>{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteMessage(m.sid)}
                      className="opacity-60 transition-opacity hover:opacity-100"
                      aria-label="Delete message"
                    >
                      <TrashIcon className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={handleSendMessage} className="mt-2 space-y-2 pb-24 lg:pb-0">
            <textarea
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              placeholder="Type a message…"
              rows={2}
              maxLength={MAX_SMS_LENGTH}
              className={`${COMPACT_INPUT_CLASS} resize-none`}
              aria-label="Message body"
            />
            {smsError && <p className={COMPACT_ERROR_CLASS}>{smsError}</p>}
            <button
              type="submit"
              disabled={sendingMessage || !messageTo.trim() || !messageBody.trim()}
              className={SMALL_BUTTON_CLASS}
            >
              {sendingMessage ? "Sending…" : "Send SMS"}
            </button>
          </form>
        </>
      )}
    </div>
  );

  const contactsTabBody = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-wide text-slate-900 dark:text-white">Contacts</h1>
        {contactsLoading && <span className="text-[10px] text-slate-400 dark:text-slate-500">syncing…</span>}
      </div>
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
                <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{c.name}</p>
                <p className="truncate text-xs text-slate-400 dark:text-slate-500">{c.number}</p>
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

      <form onSubmit={handleAddContact} className="mt-2 space-y-2 border-t border-slate-900/5 pt-4 pb-24 dark:border-white/5 lg:pb-0">
        <input
          value={newContactName}
          onChange={(e) => setNewContactName(e.target.value)}
          placeholder="Name"
          className={COMPACT_INPUT_CLASS}
          aria-label="Contact name"
        />
        <input
          value={newContactNumber}
          onChange={(e) => setNewContactNumber(e.target.value)}
          placeholder="+1 555 123 4567"
          className={COMPACT_INPUT_CLASS}
          aria-label="Contact number"
        />
        {contactFormError && <p className={COMPACT_ERROR_CLASS}>{contactFormError}</p>}
        <button type="submit" className={SMALL_BUTTON_CLASS}>
          <span className="inline-flex items-center justify-center gap-1.5">
            <PlusIcon className="h-3.5 w-3.5" />
            Add Contact
          </span>
        </button>
      </form>
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

            <div className="mt-4 grid grid-cols-3 gap-2">
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
              <div className="mt-7 flex justify-center gap-8">
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
              </div>
            )}

            {callStatus === "in-call" && keypadOpen && (
              <div className="mt-5 grid grid-cols-3 gap-2">
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
      <aside className="hidden lg:flex lg:h-dvh lg:w-[360px] lg:shrink-0 lg:flex-col lg:justify-center lg:overflow-y-auto lg:border-l lg:border-white/50 lg:bg-white/60 lg:p-6 lg:backdrop-blur-2xl lg:backdrop-saturate-150 dark:lg:border-white/10 dark:lg:bg-white/[0.04]">
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

      {/* Mobile-only call overlay - open on demand from the Calls tab's
          FAB, and forced open for the whole lifetime of an active call
          regardless of how it was started (FAB, contact, call-log redial).
          Desktop doesn't need this - the aside above is always visible. */}
      {showCallOverlay && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-[fade-in_0.2s_ease-out] lg:hidden">
          <div className={`${CARD_CLASS} animate-[pop-in_0.25s_cubic-bezier(0.16,1,0.3,1)]`}>{callPanelBody(true)}</div>
        </div>
      )}


      {/* Profile panel */}
      {profileOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-[fade-in_0.2s_ease-out]">
          <div className={`${CARD_CLASS} animate-[pop-in_0.25s_cubic-bezier(0.16,1,0.3,1)]`}>
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
              <div className="mt-2 flex justify-center gap-2">
                {Array.from({ length: PRESET_COUNT }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleChoosePreset(i)}
                    disabled={avatarUploading}
                    className={`rounded-full transition-all active:scale-90 disabled:opacity-50 ${
                      avatarUrl === `preset:${i}` ? "ring-2 ring-[#C0272D] ring-offset-2 ring-offset-white dark:ring-offset-[#0c0d10]" : ""
                    }`}
                    aria-label={`Preset avatar ${i + 1}`}
                  >
                    <Avatar label="" photoUrl={`preset:${i}`} size="lg" />
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
