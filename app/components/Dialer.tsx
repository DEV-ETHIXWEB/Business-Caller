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
import type { PublicCredentialInfo } from "@/lib/webauthn";

// The number clients will see on their caller ID. This is display-only;
// the number actually used to place the call is TWILIO_PHONE_NUMBER on the
// server (app/api/voice/route.ts). Keep these in sync if the number ever
// changes.
const DISPLAY_CALLER_ID = "+1 (206) 452-3433";

const MAX_SMS_LENGTH = 1600;

const KEYPAD_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

// The access code is remembered for 14 days, refreshed on every successful
// login (password or biometric) and every time an already-valid session is
// found on load - so staying logged in only requires opening the app at
// least once every 14 days, not 14 days from a single fixed login. Uses
// localStorage rather than sessionStorage specifically so it survives the
// browser being closed and reopened.
const SESSION_KEY = "dialer_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface StoredSession {
  code: string;
  expiresAt: number;
}

function saveSession(code: string) {
  try {
    const session: StoredSession = { code, expiresAt: Date.now() + SESSION_TTL_MS };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage can be unavailable (private browsing, quota) - worst case,
    // the access code is just asked for again next time.
  }
}

function loadSession(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof session.code !== "string" || typeof session.expiresAt !== "number") return null;
    if (Date.now() > session.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session.code;
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

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 6h16M4 12h16M4 18h16" />
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

const SIDE_PANEL_CLASS =
  "w-full rounded-[1.75rem] border border-white/70 bg-white/70 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_20px_50px_-20px_rgba(192,39,45,0.12),0_12px_28px_-15px_rgba(15,23,42,0.18)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_50px_-15px_rgba(192,39,45,0.2),0_15px_45px_-20px_rgba(0,0,0,0.8)]";

const PANEL_HEADING_CLASS = "text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

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

const MINI_ICON_BUTTON_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/60 bg-white/50 text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-sm transition-all hover:bg-white/80 active:scale-90 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10";

const CONTACT_ROW_CLASS =
  "flex items-center justify-between gap-2 rounded-xl border border-white/50 bg-white/40 px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]";

const CONVERSATION_ROW_CLASS =
  "flex w-full items-center justify-between gap-2 rounded-xl border border-white/50 bg-white/40 px-3 py-2 text-left transition-all hover:bg-white/70 active:scale-[0.98] dark:border-white/5 dark:bg-white/[0.03] dark:hover:bg-white/[0.08]";

const TAB_BUTTON_CLASS = "rounded-full px-3 py-1.5 text-xs font-medium transition-all";

const TAB_ACTIVE_CLASS = `${TAB_BUTTON_CLASS} bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white shadow-[0_6px_16px_-8px_rgba(192,39,45,0.5)]`;

const TAB_INACTIVE_CLASS = `${TAB_BUTTON_CLASS} text-slate-500 hover:bg-white/60 dark:text-slate-400 dark:hover:bg-white/5`;

const ERROR_BANNER_CLASS =
  "rounded-2xl border border-red-200/60 bg-red-50/80 px-3 py-2 text-sm text-red-700 backdrop-blur-sm dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300";

const COMPACT_ERROR_CLASS = "text-xs text-red-600 dark:text-red-400";

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
  const [accessCodeInput, setAccessCodeInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

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

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"messages" | "phonebook">("messages");

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
        const savedCode = loadSession();
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
      const savedCode = loadSession();
      if (!savedCode) {
        if (!cancelled) setCheckingSession(false);
        return;
      }

      try {
        const { token } = await requestToken(savedCode);
        if (cancelled) return;
        saveSession(savedCode);
        await setupDevice(token);
        if (!cancelled) setUnlocked(true);
      } catch {
        // The remembered code no longer works (e.g. APP_ACCESS_CODE was
        // rotated) - drop it and fall back to the normal lock screen.
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
    const code = loadSession();
    if (!code) return;
    setMessagesLoading(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code, with: number }),
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
    const code = loadSession();
    if (!code) return;
    setConversationsLoading(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code }),
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
    const code = loadSession();
    if (!code) return;
    setContactsLoading(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code }),
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

  // Writes the full contact list back to the server. Used by both add and
  // delete, since the API replaces the whole list rather than patching one
  // entry at a time.
  async function saveContactsToServer(next: Contact[]): Promise<boolean> {
    const code = loadSession();
    if (!code) return false;
    try {
      const res = await fetch("/api/contacts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code, contacts: next }),
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
    const code = loadSession();
    if (!code) return;
    try {
      const res = await fetch("/api/webauthn/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code }),
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
    setBiometricBusy(true);
    setLockError(null);
    try {
      const optsRes = await fetch("/api/webauthn/login-options", { method: "POST" });
      const optsData = (await optsRes.json().catch(() => ({}))) as {
        options?: Parameters<typeof startAuthentication>[0]["optionsJSON"];
      };
      if (!optsRes.ok || !optsData.options) throw new Error("Could not start Face ID / Touch ID.");

      const assertion = await startAuthentication({ optionsJSON: optsData.options });

      const verifyRes = await fetch("/api/webauthn/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion, expectedChallenge: optsData.options.challenge }),
      });
      const verifyData = (await verifyRes.json().catch(() => ({}))) as { accessCode?: string };
      if (!verifyRes.ok || !verifyData.accessCode) throw new Error("Could not verify.");

      const { token } = await requestToken(verifyData.accessCode);
      saveSession(verifyData.accessCode);
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

    const accessCode = loadSession();
    if (!accessCode) {
      setRegisteringDevice(false);
      return;
    }

    try {
      const optsRes = await fetch("/api/webauthn/register-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode }),
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
          accessCode,
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
    const accessCode = loadSession();
    if (!accessCode) return;
    try {
      const res = await fetch("/api/webauthn/devices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode, id }),
      });
      const data = (await res.json().catch(() => ({}))) as { devices?: PublicCredentialInfo[] };
      if (res.ok && data.devices) setDevices(data.devices);
    } catch {
      // Best-effort; the list simply reflects whatever's on the server next time it loads.
    }
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
      const { token } = await requestToken(accessCodeInput);
      saveSession(accessCodeInput);
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
    setAccessCodeInput("");
    setPhoneNumber("");
    setInputDevices([]);
    setOutputDevices([]);
    setMessageTo("");
    setActiveThread(null);
    setMessageBody("");
    setSmsError(null);
    setMobileMenuOpen(false);
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

    const accessCode = loadSession();
    if (!accessCode) {
      setSmsError("Your session expired. Please sign out and enter the access code again.");
      return;
    }

    setSendingMessage(true);
    try {
      const res = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode, to: activeThread, message: body }),
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
    const accessCode = loadSession();
    if (!accessCode) return;
    try {
      await fetch("/api/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode, sid }),
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
    const accessCode = loadSession();
    if (!accessCode) return;
    try {
      await fetch("/api/conversations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode, with: number }),
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
  const messagesPanelBody = (
    <div className={`${SIDE_PANEL_CLASS} flex min-h-0 flex-1 flex-col`}>
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
        <h2 className={`${PANEL_HEADING_CLASS} truncate`}>
          {activeThread ? (threadContactName ?? activeThread) : "Messages"}
        </h2>
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
          <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
            {conversationsLoading && conversations.length === 0 && (
              <p className="p-2 text-center text-xs text-slate-400 dark:text-slate-500">Loading…</p>
            )}
            {!conversationsLoading && conversations.length === 0 && (
              <p className="p-2 text-center text-xs text-slate-400 dark:text-slate-500">No conversations yet.</p>
            )}
            {conversations.map((c) => (
              <div key={c.number} className={CONVERSATION_ROW_CLASS}>
                <button
                  type="button"
                  onClick={() => {
                    playTap();
                    setMessageTo(c.number);
                    setActiveThread(c.number);
                    setMobileTab("messages");
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                    {contacts.find((ct) => ct.number === c.number)?.name ?? c.number}
                  </p>
                  <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                    {c.lastDirection === "outbound" ? "You: " : ""}
                    {c.lastBody}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    {new Date(c.lastAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteConversation(c.number)}
                    className={MINI_ICON_BUTTON_CLASS}
                    aria-label={`Delete conversation with ${contacts.find((ct) => ct.number === c.number)?.name ?? c.number}`}
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div
            ref={threadScrollRef}
            className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl border border-white/40 bg-white/20 p-2 dark:border-white/5 dark:bg-black/10"
          >
            {messageLog.length === 0 && !messagesLoading && (
              <p className="p-2 text-center text-xs text-slate-400 dark:text-slate-500">No messages yet.</p>
            )}
            {messageLog.map((m) => (
              <div key={m.sid} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-xs ${
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

          <form onSubmit={handleSendMessage} className="mt-2 space-y-2">
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

  const phoneBookPanelBody = (
    <div className={SIDE_PANEL_CLASS}>
      <div className="flex items-center justify-between">
        <h2 className={PANEL_HEADING_CLASS}>Phone Book</h2>
        {contactsLoading && (
          <span className="text-[10px] text-slate-400 dark:text-slate-500">syncing…</span>
        )}
      </div>

      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
        {contacts.length === 0 && !contactsLoading && (
          <p className="text-xs text-slate-400 dark:text-slate-500">No saved contacts yet.</p>
        )}
        {contacts.map((c) => (
          <div key={c.id} className={CONTACT_ROW_CLASS}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{c.name}</p>
              <p className="truncate text-xs text-slate-400 dark:text-slate-500">{c.number}</p>
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
                  setMobileTab("messages");
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

      <form onSubmit={handleAddContact} className="mt-4 space-y-2 border-t border-slate-900/5 pt-4 dark:border-white/5">
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
            Enter your access code to continue
          </p>

          {biometricSupported && (
            <>
              <button
                type="button"
                onClick={handleBiometricUnlock}
                disabled={biometricBusy}
                className={`${PRIMARY_BUTTON_CLASS} flex items-center justify-center gap-2`}
              >
                <FingerprintIcon className="h-4 w-4" />
                {biometricBusy ? "Verifying…" : "Unlock with Face ID / Touch ID"}
              </button>
              <div className="my-4 flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
                <div className="h-px flex-1 bg-slate-900/10 dark:bg-white/10" />
                or enter your access code
                <div className="h-px flex-1 bg-slate-900/10 dark:bg-white/10" />
              </div>
            </>
          )}

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
      {/* Mobile-only hamburger, opens a drawer with Messages + Phone Book */}
      <button
        type="button"
        onClick={() => {
          playTap();
          setMobileMenuOpen(true);
        }}
        className="fixed left-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-white/60 bg-white/70 text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_25px_-10px_rgba(15,23,42,0.4)] backdrop-blur-xl transition-all active:scale-90 lg:hidden dark:border-white/10 dark:bg-white/10 dark:text-slate-200"
        aria-label="Open messages and phone book"
      >
        <MenuIcon className="h-5 w-5" />
      </button>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative flex h-full w-full flex-col gap-3 border-r border-white/20 bg-[#F7F2F1]/95 p-4 pt-6 backdrop-blur-2xl dark:border-white/5 dark:bg-[#0c0d10]/95">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    playTap();
                    setMobileTab("messages");
                  }}
                  className={mobileTab === "messages" ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}
                >
                  Messages
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playTap();
                    setMobileTab("phonebook");
                  }}
                  className={mobileTab === "phonebook" ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}
                >
                  Phone Book
                </button>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className={MINI_ICON_BUTTON_CLASS}
                aria-label="Close"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            {mobileTab === "messages" ? messagesPanelBody : phoneBookPanelBody}
          </div>
        </div>
      )}

      <div className="flex w-full max-w-6xl flex-col items-center gap-6 lg:flex-row lg:items-start lg:justify-center">
        {/* Messages panel - desktop only, mobile reaches it via the drawer above.
            Height matches the viewport (minus Shell's py-8) so the thread
            area fills real screen space instead of a small fixed box. */}
        <div className="order-2 hidden w-full max-w-xs shrink-0 lg:order-1 lg:flex lg:h-[calc(100dvh-4rem)] lg:flex-col">
          {messagesPanelBody}
        </div>

        {/* Dialer */}
        <div className={`order-1 mx-auto shrink-0 lg:order-2 ${CARD_CLASS}`}>
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

          {biometricSupported && (
            <div className="mt-4 border-t border-slate-900/5 pt-4 dark:border-white/5">
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
        </div>

        {/* Phone book panel - desktop only, mobile reaches it via the drawer above */}
        <div className="order-3 hidden w-full max-w-xs shrink-0 lg:block">{phoneBookPanelBody}</div>
      </div>
    </Shell>
  );
}
