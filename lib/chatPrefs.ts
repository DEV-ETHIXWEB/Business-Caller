"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

// Per-person, per-device chat state, like WhatsApp's pinned chats, unread
// marks and unsent drafts. Kept in localStorage (text messages themselves
// live in Twilio; Twilio has no "read" state to ask), keyed by username so
// two people sharing one browser never see each other's.

export interface ChatPrefs {
  /** Numbers pinned to the top of the list. */
  pinned: string[];
  /** Per number: when this device last opened the chat (epoch ms). */
  readAt: Record<string, number>;
  /** Numbers the person marked unread by hand. */
  markedUnread: string[];
  /** Per number: text typed but not sent. */
  drafts: Record<string, string>;
  /** Chats older than this were already there when this device started, so
   * they never show as unread. */
  baseline: number;
}

const EMPTY: ChatPrefs = { pinned: [], readAt: {}, markedUnread: [], drafts: {}, baseline: 0 };

const keyFor = (username: string) => `dialer_chatprefs:${username}`;

function parse(raw: string | null): ChatPrefs {
  if (!raw) return EMPTY;
  try {
    const d = JSON.parse(raw) as Partial<ChatPrefs>;
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const record = <T,>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> => {
      const out: Record<string, T> = {};
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (ok(x)) out[k] = x;
      return out;
    };
    return {
      pinned: strings(d.pinned),
      readAt: record(d.readAt, (x): x is number => typeof x === "number"),
      markedUnread: strings(d.markedUnread),
      drafts: record(d.drafts, (x): x is string => typeof x === "string"),
      baseline: typeof d.baseline === "number" ? d.baseline : 0,
    };
  } catch {
    return EMPTY;
  }
}

const cache = new Map<string, { raw: string | null; value: ChatPrefs }>();
const listeners = new Set<() => void>();

function read(username: string): ChatPrefs {
  if (!username) return EMPTY;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(keyFor(username));
  } catch {
    // Storage blocked: falls back to the in-memory copy below.
    return cache.get(username)?.value ?? EMPTY;
  }
  const hit = cache.get(username);
  if (hit && hit.raw === raw) return hit.value;
  const value = parse(raw);
  cache.set(username, { raw, value });
  return value;
}

function write(username: string, next: ChatPrefs) {
  const raw = JSON.stringify(next);
  try {
    localStorage.setItem(keyFor(username), raw);
  } catch {
    // Kept in memory only for this session.
  }
  cache.set(username, { raw, value: next });
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("dialer_chatprefs:")) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export interface ChatPrefsApi {
  prefs: ChatPrefs;
  isPinned: (number: string) => boolean;
  togglePin: (number: string) => void;
  /** Called when a chat is opened or viewed. */
  markRead: (number: string) => void;
  markUnread: (number: string) => void;
  setDraft: (number: string, text: string) => void;
  /** Whether the list should show this chat as unread. */
  isUnread: (c: { number: string; lastDirection: "inbound" | "outbound"; lastAt: number }) => boolean;
  forget: (number: string) => void;
}

export function useChatPrefs(username: string): ChatPrefsApi {
  const prefs = useSyncExternalStore(
    subscribe,
    () => read(username),
    () => EMPTY,
  );

  const update = useCallback(
    (fn: (p: ChatPrefs) => ChatPrefs) => {
      if (!username) return;
      const current = read(username);
      // The first time this device sees this person, everything already there
      // counts as read.
      const base = current.baseline ? current : { ...current, baseline: Date.now() };
      write(username, fn(base));
    },
    [username],
  );

  // Stamp "first seen" once, so chats that were already there are not unread.
  useEffect(() => {
    if (username && !read(username).baseline) update((p) => p);
  }, [username, update]);

  return {
    prefs,
    isPinned: (number) => prefs.pinned.includes(number),
    togglePin: (number) =>
      update((p) => ({ ...p, pinned: p.pinned.includes(number) ? p.pinned.filter((n) => n !== number) : [number, ...p.pinned] })),
    markRead: (number) =>
      update((p) => {
        if (!p.markedUnread.includes(number) && p.readAt[number] && Date.now() - p.readAt[number] < 1500) return p;
        return { ...p, readAt: { ...p.readAt, [number]: Date.now() }, markedUnread: p.markedUnread.filter((n) => n !== number) };
      }),
    markUnread: (number) => update((p) => (p.markedUnread.includes(number) ? p : { ...p, markedUnread: [...p.markedUnread, number] })),
    setDraft: (number, text) =>
      update((p) => {
        const drafts = { ...p.drafts };
        if (text.trim()) drafts[number] = text;
        else delete drafts[number];
        if (drafts[number] === p.drafts[number]) return p;
        return { ...p, drafts };
      }),
    isUnread: (c) => {
      if (prefs.markedUnread.includes(c.number)) return true;
      if (c.lastDirection !== "inbound") return false;
      const seen = Math.max(prefs.readAt[c.number] ?? 0, prefs.baseline);
      return c.lastAt > seen;
    },
    forget: (number) =>
      update((p) => {
        const readAt = { ...p.readAt };
        const drafts = { ...p.drafts };
        delete readAt[number];
        delete drafts[number];
        return { ...p, pinned: p.pinned.filter((n) => n !== number), markedUnread: p.markedUnread.filter((n) => n !== number), readAt, drafts };
      }),
  };
}
