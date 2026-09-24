"use client";

// App lock, chat lock and the secret code. The PIN is never stored: only a
// salted PBKDF2 hash of it, on this device. It guards what is on this screen
// (the app and chosen chats) against someone holding an unlocked phone or
// laptop. It does not encrypt anything, and the person's password is still what
// protects their account.

export interface LockConfig {
  /** Salted hash of the PIN. */
  pin: HashedSecret;
  /** Lock again after this many idle minutes (0 = only when the app starts). */
  autoLockMinutes: number;
  /** Optional word that reveals locked chats when typed in the search box. */
  secret?: HashedSecret;
  /** Wrong tries so far, and when the next try is allowed. */
  failures: number;
  lockedUntil: number;
}

export interface HashedSecret {
  salt: string;
  hash: string;
  length: number;
}

const ITERATIONS = 120_000;
const KEY = (username: string) => `dialer_lock:${username}`;

const b64 = (bytes: ArrayBuffer | Uint8Array) => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  u.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(secret: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITERATIONS }, key, 256);
  return b64(bits);
}

export async function hashSecret(secret: string): Promise<HashedSecret> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: await derive(secret, salt), length: secret.length };
}

// A constant-time comparison, so a wrong guess does not reveal how close it was.
export async function checkSecret(secret: string, stored: HashedSecret): Promise<boolean> {
  if (secret.length !== stored.length) return false;
  const got = await derive(secret, unb64(stored.salt));
  if (got.length !== stored.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ stored.hash.charCodeAt(i);
  return diff === 0;
}

const isSecret = (x: unknown): x is HashedSecret => {
  const s = x as HashedSecret;
  return !!s && typeof s.salt === "string" && typeof s.hash === "string" && typeof s.length === "number";
};

export function loadLock(username: string): LockConfig | null {
  if (!username) return null;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(username)) || "null") as Partial<LockConfig> | null;
    if (!raw || !isSecret(raw.pin)) return null;
    return {
      pin: raw.pin,
      autoLockMinutes: typeof raw.autoLockMinutes === "number" ? raw.autoLockMinutes : 0,
      secret: isSecret(raw.secret) ? raw.secret : undefined,
      failures: typeof raw.failures === "number" ? raw.failures : 0,
      lockedUntil: typeof raw.lockedUntil === "number" ? raw.lockedUntil : 0,
    };
  } catch {
    return null;
  }
}

export function saveLock(username: string, config: LockConfig | null) {
  try {
    if (config) localStorage.setItem(KEY(username), JSON.stringify(config));
    else localStorage.removeItem(KEY(username));
  } catch {
    // Storage blocked: the lock only lasts for this session.
  }
}

export const MAX_FREE_TRIES = 4;

// After a few wrong tries, each further wrong try makes you wait longer.
export function lockoutSeconds(failures: number): number {
  if (failures <= MAX_FREE_TRIES) return 0;
  return Math.min(900, 15 * 2 ** (failures - MAX_FREE_TRIES - 1));
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}
