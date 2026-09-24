"use client";

import { useCallback, useSyncExternalStore } from "react";

// Per-device display preferences (like WhatsApp's Settings > Chats). Kept in
// localStorage: they describe this screen, not the person, so a phone and a
// laptop can differ. The mood status and About line are the person's own and
// live on the server instead (see lib/profileStore.ts).

export type ThemeSetting = "system" | "light" | "dark";
export type TextSizeSetting = "small" | "medium" | "large" | "xlarge";
export type WallpaperSetting = "dots" | "blush" | "plain";
export type BubbleTheme = "crimson" | "wine" | "charcoal" | "black";
export type MessageSound = "chime" | "pop" | "bell" | "off";

export interface Settings {
  theme: ThemeSetting;
  textSize: TextSizeSetting;
  wallpaper: WallpaperSetting;
  /** The tap click sound. */
  sounds: boolean;
  /** The tap vibration (Android; iOS Safari has no vibration API). */
  haptics: boolean;
  /** Computer keyboards: Enter sends and Shift+Enter is a new line. */
  enterToSend: boolean;
  /** Also text the other person your emoji reaction (costs one SMS each). */
  reactionsAsText: boolean;
  /** Load photos, videos and voice notes as soon as a chat opens (off = tap to load, saves data). */
  autoDownload: boolean;
  /** Colour of your own message bubbles. */
  bubbleTheme: BubbleTheme;
  /** The sound for a new text while the app is open. */
  messageSound: MessageSound;
  /** Show the message text in a desktop notification (off = just "New message"). */
  notifyPreview: boolean;
  /** Pop up a desktop notification for a new text while the tab is in the background. */
  desktopNotifications: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  textSize: "medium",
  wallpaper: "dots",
  sounds: true,
  haptics: true,
  enterToSend: true,
  reactionsAsText: false,
  autoDownload: true,
  bubbleTheme: "crimson",
  messageSound: "chime",
  notifyPreview: true,
  desktopNotifications: false,
};

export const SETTINGS_KEY = "dialer_settings";

const THEMES: ThemeSetting[] = ["system", "light", "dark"];
const TEXT_SIZES: TextSizeSetting[] = ["small", "medium", "large", "xlarge"];
const WALLPAPERS: WallpaperSetting[] = ["dots", "blush", "plain"];
const BUBBLES: BubbleTheme[] = ["crimson", "wine", "charcoal", "black"];
const SOUNDS: MessageSound[] = ["chime", "pop", "bell", "off"];

function parseSettings(raw: string | null): Settings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const data = JSON.parse(raw) as Partial<Settings>;
    return {
      theme: THEMES.includes(data.theme as ThemeSetting) ? (data.theme as ThemeSetting) : DEFAULT_SETTINGS.theme,
      textSize: TEXT_SIZES.includes(data.textSize as TextSizeSetting)
        ? (data.textSize as TextSizeSetting)
        : DEFAULT_SETTINGS.textSize,
      wallpaper: WALLPAPERS.includes(data.wallpaper as WallpaperSetting)
        ? (data.wallpaper as WallpaperSetting)
        : DEFAULT_SETTINGS.wallpaper,
      sounds: typeof data.sounds === "boolean" ? data.sounds : DEFAULT_SETTINGS.sounds,
      haptics: typeof data.haptics === "boolean" ? data.haptics : DEFAULT_SETTINGS.haptics,
      enterToSend: typeof data.enterToSend === "boolean" ? data.enterToSend : DEFAULT_SETTINGS.enterToSend,
      reactionsAsText: typeof data.reactionsAsText === "boolean" ? data.reactionsAsText : DEFAULT_SETTINGS.reactionsAsText,
      autoDownload: typeof data.autoDownload === "boolean" ? data.autoDownload : DEFAULT_SETTINGS.autoDownload,
      bubbleTheme: BUBBLES.includes(data.bubbleTheme as BubbleTheme) ? (data.bubbleTheme as BubbleTheme) : DEFAULT_SETTINGS.bubbleTheme,
      messageSound: SOUNDS.includes(data.messageSound as MessageSound) ? (data.messageSound as MessageSound) : DEFAULT_SETTINGS.messageSound,
      notifyPreview: typeof data.notifyPreview === "boolean" ? data.notifyPreview : DEFAULT_SETTINGS.notifyPreview,
      desktopNotifications: typeof data.desktopNotifications === "boolean" ? data.desktopNotifications : DEFAULT_SETTINGS.desktopNotifications,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// useSyncExternalStore needs a stable snapshot reference, so the parsed value
// is cached against the raw string it came from.
let cachedRaw: string | null | undefined;
let cachedValue: Settings = DEFAULT_SETTINGS;

function readRaw(): string | null {
  try {
    return localStorage.getItem(SETTINGS_KEY);
  } catch {
    return null;
  }
}

function getSnapshot(): Settings {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parseSettings(raw);
  }
  return cachedValue;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SETTINGS_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function loadSettings(): Settings {
  return getSnapshot();
}

// Puts the settings on <html> so CSS can react to them. The same logic runs
// inline in app/layout.tsx before first paint, so there is no flash.
export function applySettings(settings: Settings) {
  const root = document.documentElement;
  const dark =
    settings.theme === "dark" ||
    (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  root.dataset.textSize = settings.textSize;
  root.dataset.wallpaper = settings.wallpaper;
  root.dataset.bubble = settings.bubbleTheme;
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_SETTINGS);

  const update = useCallback((patch: Partial<Settings>) => {
    const next = { ...getSnapshot(), ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked (private mode): the change still applies until reload.
      cachedRaw = JSON.stringify(next);
      cachedValue = next;
    }
    applySettings(next);
    listeners.forEach((l) => l());
  }, []);

  return [settings, update];
}
