import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getClientIp, rateLimit } from "./rateLimit";
import { burnPasswordWork, verifyPassword } from "./password";
import { readSessionToken } from "./session";
import { findUserByUsername, type AppUser } from "./users";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Looks up a user by username and checks their password.
 *
 * An unknown username still does the hashing work (burnPasswordWork)
 * before giving up. Returning early instead would make a wrong username
 * measurably faster than a wrong password, which hands an attacker the
 * list of real usernames for free - the first thing they need before
 * trying to guess anyone's password.
 */
export function verifyUserCredentials(username: string, password: string): AppUser | null {
  if (!username || !password) return null;
  const user = findUserByUsername(username);
  if (!user) {
    burnPasswordWork(password);
    return null;
  }
  if (user.passwordHash) {
    if (!verifyPassword(password, user.passwordHash)) return null;
    return user;
  }
  // Legacy plaintext entry - see AppUser.password. Still constant-time.
  if (!user.password || !safeEqual(password, user.password)) return null;
  return user;
}

/** The user a valid session token belongs to, or null. */
export function userFromSessionToken(token: string): AppUser | null {
  const claims = readSessionToken(token);
  if (!claims) return null;
  return findUserByUsername(claims.username) ?? null;
}

export interface RequireUserOptions {
  /** Prefix for the rate-limit bucket key, e.g. "sms" - combined with the caller's IP. */
  rateLimitKey: string;
  limit: number;
  windowMs: number;
  /** Env vars this route needs; missing any of them is a 500, not a 401. */
  requiredEnvVars: readonly string[];
}

export interface AuthedRequest {
  user: AppUser;
  body: Record<string, unknown>;
}

/**
 * The full gate every authenticated route runs before doing anything else:
 * required env vars present, caller under the rate limit, body parses as
 * JSON, and the username/password in it are valid. Centralized so this
 * sequence - and its exact error responses - can't drift between routes,
 * the way lib/auth.ts already aimed for with the old single-code version.
 */
export async function requireUser(
  req: Request,
  opts: RequireUserOptions,
): Promise<{ ok: true; data: AuthedRequest } | { ok: false; response: NextResponse }> {
  for (const key of opts.requiredEnvVars) {
    if (!process.env[key]) {
      console.error(`[auth] Missing required environment variable: ${key}`);
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Server misconfiguration. Please contact the administrator." },
          { status: 500 },
        ),
      };
    }
  }

  const ip = getClientIp(req);
  const limit = rateLimit(`${opts.rateLimitKey}:${ip}`, opts.limit, opts.windowMs);
  if (!limit.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Too many requests. Please wait a few minutes and try again." },
        {
          status: 429,
          headers: { "Retry-After": Math.ceil(limit.retryAfterMs / 1000).toString() },
        },
      ),
    };
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid request body." }, { status: 400 }) };
  }

  const fields = (body ?? {}) as Record<string, unknown>;

  // A session token is the normal way in: /api/token mints one at sign-in
  // and the browser sends that instead of the password from then on, so
  // the password crosses the wire once per session rather than on every
  // poll. Username/password is still accepted so that /api/token itself
  // has something to authenticate, and so a client holding an expired
  // token can sign back in.
  const token = typeof fields.token === "string" ? fields.token : "";
  const user = token
    ? userFromSessionToken(token)
    : verifyUserCredentials(
        typeof fields.username === "string" ? fields.username : "",
        typeof fields.password === "string" ? fields.password : "",
      );

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: token ? "Your session has expired. Please sign in again." : "Invalid username or password." },
        { status: 401 },
      ),
    };
  }

  return { ok: true, data: { user, body: fields } };
}
