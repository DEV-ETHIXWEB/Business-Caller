"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

// Per-person, per-device chat state, like WhatsApp's pinned chats, unread
// marks, drafts, stars and reactions. Kept in localStorage (the texts
// themselves live in Twilio; Twilio has no "read", "starred" or "muted" flag
// to ask), keyed by username so two people sharing one browser never see each
// other's. "Backup" in Settings exports and restores all of it.

export interface StarredRecord {
  number: string;
  body: string;
  at: number;
  direction: "inbound" | "outbound";
  hasMedia?: boolean;
}

export interface ChatLabel {
  id: string;
  name: string;
  color: string;
}

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
  archived: string[];
  favorites: string[];
  /** Per number: muted until this time (epoch ms). */
  muted: Record<string, number>;
  blocked: string[];
  /** Chats hidden behind the app PIN ("chat lock"). */
  locked: string[];
  labelDefs: ChatLabel[];
  chatLabels: Record<string, string[]>;
  /** Per number: seconds after which messages are removed (0 or absent = off). */
  disappearing: Record<string, number>;
  /** Per number: a wallpaper that overrides the global one. */
  chatWallpaper: Record<string, string>;
  starred: Record<string, StarredRecord>;
  /** Message ids removed "for me" (kept in Twilio, hidden here). */
  hidden: string[];
  /** Per message id: the emoji you reacted with. */
  reactions: Record<string, string>;
  /** Per number: one message pinned to the top of the chat. */
  pinnedMessage: Record<string, { sid: string; body: string }>;
}

export const FOREVER = 8_000_000_000_000_000; // "always", far beyond any real date

const EMPTY: ChatPrefs = {
  pinned: [],
  readAt: {},
  markedUnread: [],
  drafts: {},
  baseline: 0,
  archived: [],
  favorites: [],
  muted: {},
  blocked: [],
  locked: [],
  labelDefs: [],
  chatLabels: {},
  disappearing: {},
  chatWallpaper: {},
  starred: {},
  hidden: [],
  reactions: {},
  pinnedMessage: {},
};

const keyFor = (username: string) => `dialer_chatprefs:${username}`;

const isString = (x: unknown): x is string => typeof x === "string";
const isNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(isString) : [];
}

function record<T>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> {
  const out: Record<string, T> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) if (ok(x)) out[k] = x;
  return out;
}

const isStarred = (x: unknown): x is StarredRecord => {
  const s = x as StarredRecord;
  return !!s && isString(s.number) && isString(s.body) && isNumber(s.at) && (s.direction === "inbound" || s.direction === "outbound");
};
const isPinnedMessage = (x: unknown): x is { sid: string; body: string } => {
  const s = x as { sid: string; body: string };
  return !!s && isString(s.sid) && isString(s.body);
};
const isLabel = (x: unknown): x is ChatLabel => {
  const s = x as ChatLabel;
  return !!s && isString(s.id) && isString(s.name) && isString(s.color);
};

export function parsePrefs(raw: unknown): ChatPrefs {
  if (!raw || typeof raw !== "object") return EMPTY;
  const d = raw as Partial<Record<keyof ChatPrefs, unknown>>;
  return {
    pinned: strings(d.pinned),
    readAt: record(d.readAt, isNumber),
    markedUnread: strings(d.markedUnread),
    drafts: record(d.drafts, isString),
    baseline: isNumber(d.baseline) ? d.baseline : 0,
    archived: strings(d.archived),
    favorites: strings(d.favorites),
    muted: record(d.muted, isNumber),
    blocked: strings(d.blocked),
    locked: strings(d.locked),
    labelDefs: Array.isArray(d.labelDefs) ? d.labelDefs.filter(isLabel) : [],
    chatLabels: (() => {
      const out: Record<string, string[]> = {};
      if (d.chatLabels && typeof d.chatLabels === "object") for (const [k, v] of Object.entries(d.chatLabels)) out[k] = strings(v);
      return out;
    })(),
    disappearing: record(d.disappearing, isNumber),
    chatWallpaper: record(d.chatWallpaper, isString),
    starred: record(d.starred, isStarred),
    hidden: strings(d.hidden),
    reactions: record(d.reactions, isString),
    pinnedMessage: record(d.pinnedMessage, isPinnedMessage),
  };
}

function parse(raw: string | null): ChatPrefs {
  if (!raw) return EMPTY;
  try {
    return parsePrefs(JSON.parse(raw));
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

const toggle = (list: string[], value: string): string[] => (list.includes(value) ? list.filter((v) => v !== value) : [value, ...list]);
const without = <T,>(rec: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in rec)) return rec;
  const next = { ...rec };
  delete next[key];
  return next;
};

export interface ChatPrefsApi {
  prefs: ChatPrefs;
  isPinned: (number: string) => boolean;
  togglePin: (number: string) => void;
  /** Called when a chat is opened or viewed. */
  markRead: (number: string) => void;
  markUnread: (number: string) => void;
  markAllRead: (numbers: string[]) => void;
  setDraft: (number: string, text: string) => void;
  /** Whether the list should show this chat as unread. */
  isUnread: (c: { number: string; lastDirection: "inbound" | "outbound"; lastAt: number }) => boolean;
  forget: (number: string) => void;

  isArchived: (number: string) => boolean;
  toggleArchive: (number: string) => void;
  isFavorite: (number: string) => boolean;
  toggleFavorite: (number: string) => void;
  isMuted: (number: string) => boolean;
  /** Mute for a while (ms), forever, or pass 0 to unmute. */
  mute: (number: string, forMs: number) => void;
  isBlocked: (number: string) => boolean;
  toggleBlock: (number: string) => void;
  isLocked: (number: string) => boolean;
  toggleLock: (number: string) => void;

  addLabel: (name: string, color: string) => string;
  removeLabel: (id: string) => void;
  toggleChatLabel: (number: string, labelId: string) => void;

  setDisappearing: (number: string, seconds: number) => void;
  setChatWallpaper: (number: string, wallpaper: string | null) => void;

  isStarred: (sid: string) => boolean;
  toggleStar: (sid: string, record: StarredRecord) => void;
  unstarMany: (sids: string[]) => void;
  hide: (sids: string[]) => void;
  isHidden: (sid: string) => boolean;
  react: (sid: string, emoji: string | null) => void;
  setPinnedMessage: (number: string, msg: { sid: string; body: string } | null) => void;

  exportBackup: () => string;
  importBackup: (json: string) => boolean;
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
      const next = fn(base);
      if (next !== current) write(username, next);
    },
    [username],
  );

  // Stamp "first seen" once, so chats that were already there are not unread.
  useEffect(() => {
    if (username && !read(username).baseline) update((p) => p);
  }, [username, update]);

  const now = () => Date.now();

  return {
    prefs,
    isPinned: (number) => prefs.pinned.includes(number),
    togglePin: (number) => update((p) => ({ ...p, pinned: toggle(p.pinned, number) })),
    markRead: (number) =>
      update((p) => {
        if (!p.markedUnread.includes(number) && p.readAt[number] && now() - p.readAt[number] < 1500) return p;
        return { ...p, readAt: { ...p.readAt, [number]: now() }, markedUnread: p.markedUnread.filter((n) => n !== number) };
      }),
    markUnread: (number) => update((p) => (p.markedUnread.includes(number) ? p : { ...p, markedUnread: [...p.markedUnread, number] })),
    markAllRead: (numbers) =>
      update((p) => {
        const readAt = { ...p.readAt };
        for (const n of numbers) readAt[n] = now();
        return { ...p, readAt, markedUnread: [] };
      }),
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
      update((p) => ({
        ...p,
        pinned: p.pinned.filter((n) => n !== number),
        markedUnread: p.markedUnread.filter((n) => n !== number),
        archived: p.archived.filter((n) => n !== number),
        favorites: p.favorites.filter((n) => n !== number),
        locked: p.locked.filter((n) => n !== number),
        readAt: without(p.readAt, number),
        drafts: without(p.drafts, number),
        muted: without(p.muted, number),
        chatLabels: without(p.chatLabels, number),
        disappearing: without(p.disappearing, number),
        chatWallpaper: without(p.chatWallpaper, number),
        pinnedMessage: without(p.pinnedMessage, number),
      })),

    isArchived: (n) => prefs.archived.includes(n),
    toggleArchive: (n) => update((p) => ({ ...p, archived: toggle(p.archived, n), pinned: p.archived.includes(n) ? p.pinned : p.pinned.filter((x) => x !== n) })),
    isFavorite: (n) => prefs.favorites.includes(n),
    toggleFavorite: (n) => update((p) => ({ ...p, favorites: toggle(p.favorites, n) })),
    isMuted: (n) => (prefs.muted[n] ?? 0) > now(),
    mute: (n, forMs) =>
      update((p) => (forMs <= 0 ? { ...p, muted: without(p.muted, n) } : { ...p, muted: { ...p.muted, [n]: forMs >= FOREVER ? FOREVER : now() + forMs } })),
    isBlocked: (n) => prefs.blocked.includes(n),
    toggleBlock: (n) => update((p) => ({ ...p, blocked: toggle(p.blocked, n) })),
    isLocked: (n) => prefs.locked.includes(n),
    toggleLock: (n) => update((p) => ({ ...p, locked: toggle(p.locked, n) })),

    addLabel: (name, color) => {
      const id = `lb-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      update((p) => ({ ...p, labelDefs: [...p.labelDefs, { id, name: name.trim().slice(0, 24), color }] }));
      return id;
    },
    removeLabel: (id) =>
      update((p) => {
        const chatLabels: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(p.chatLabels)) {
          const rest = v.filter((x) => x !== id);
          if (rest.length) chatLabels[k] = rest;
        }
        return { ...p, labelDefs: p.labelDefs.filter((l) => l.id !== id), chatLabels };
      }),
    toggleChatLabel: (n, id) =>
      update((p) => {
        const cur = p.chatLabels[n] ?? [];
        const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
        const chatLabels = { ...p.chatLabels };
        if (next.length) chatLabels[n] = next;
        else delete chatLabels[n];
        return { ...p, chatLabels };
      }),

    setDisappearing: (n, seconds) =>
      update((p) => ({ ...p, disappearing: seconds > 0 ? { ...p.disappearing, [n]: seconds } : without(p.disappearing, n) })),
    setChatWallpaper: (n, w) => update((p) => ({ ...p, chatWallpaper: w ? { ...p.chatWallpaper, [n]: w } : without(p.chatWallpaper, n) })),

    isStarred: (sid) => sid in prefs.starred,
    toggleStar: (sid, record) => update((p) => ({ ...p, starred: sid in p.starred ? without(p.starred, sid) : { ...p.starred, [sid]: record } })),
    unstarMany: (sids) =>
      update((p) => {
        const starred = { ...p.starred };
        for (const s of sids) delete starred[s];
        return { ...p, starred };
      }),
    hide: (sids) => update((p) => ({ ...p, hidden: Array.from(new Set([...p.hidden, ...sids])).slice(-2000) })),
    isHidden: (sid) => prefs.hidden.includes(sid),
    react: (sid, emoji) => update((p) => ({ ...p, reactions: emoji ? { ...p.reactions, [sid]: emoji } : without(p.reactions, sid) })),
    setPinnedMessage: (n, msg) => update((p) => ({ ...p, pinnedMessage: msg ? { ...p.pinnedMessage, [n]: msg } : without(p.pinnedMessage, n) })),

    exportBackup: () => JSON.stringify({ app: "business-caller", kind: "chat-prefs", version: 1, exportedAt: now(), prefs }, null, 2),
    importBackup: (json) => {
      try {
        const data = JSON.parse(json) as { app?: string; kind?: string; prefs?: unknown };
        if (data.app !== "business-caller" || data.kind !== "chat-prefs" || !data.prefs) return false;
        update((p) => ({ ...parsePrefs(data.prefs), baseline: p.baseline || now() }));
        return true;
      } catch {
        return false;
      }
    },
  };
}
