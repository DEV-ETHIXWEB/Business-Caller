import { sign, verify } from "./secrets";

// Server-only. Short-lived bearer tokens the browser holds instead of the
// person's password.
//
// Every API call used to carry the username and password in its body, and
// the browser kept both in localStorage for 14 days to be able to do that.
// So the password was replayed every few seconds by the message poller,
// sat in storage any script on the page could read, and - because nothing
// else identified a session - could not be revoked without changing
// APP_USERS and redeploying. A token fixes all three: it expires on its
// own, it is useless after `issuedAt` passes the user's cutoff, and the
// password is sent exactly once, at sign-in.
//
// Format: <username>.<issuedAt>.<expiresAt>.<hmac>, all base64url-free
// ASCII so it survives JSON and headers untouched. The HMAC covers every
// other field, so none of them can be edited - in particular the username,
// which is what decides whose number and messages the request reaches.

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SEPARATOR = ".";

export interface SessionClaims {
  username: string;
  issuedAt: number;
  expiresAt: number;
}

function payload(username: string, issuedAt: number, expiresAt: number): string {
  return `${username}${SEPARATOR}${issuedAt}${SEPARATOR}${expiresAt}`;
}

export function issueSessionToken(username: string, now = Date.now()): string {
  const expiresAt = now + TOKEN_TTL_MS;
  const body = payload(username, now, expiresAt);
  return `${body}${SEPARATOR}${sign("session-token", body)}`;
}

/**
 * Returns the claims a token proves, or null if it is malformed, expired,
 * or not signed by this server. Never throws - a bad token is an ordinary
 * "not signed in", not an error.
 */
export function readSessionToken(token: string, now = Date.now()): SessionClaims | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const parts = token.split(SEPARATOR);
  if (parts.length !== 4) return null;
  const [username, issuedRaw, expiresRaw, signature] = parts;
  const issuedAt = Number(issuedRaw);
  const expiresAt = Number(expiresRaw);
  if (!username || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) return null;
  if (now >= expiresAt) return null;
  // Checked after the cheap structural tests so a flood of junk tokens
  // doesn't make the server do HMAC work for every one of them.
  if (!verify("session-token", payload(username, issuedAt, expiresAt), signature)) return null;
  return { username, issuedAt, expiresAt };
}

export const SESSION_TTL_MS = TOKEN_TTL_MS;
