import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getClientIp, rateLimit } from "./rateLimit";
import { findUserByUsername, type AppUser } from "./users";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Looks up a user by username and checks their password with a
 * constant-time comparison.
 */
export function verifyUserCredentials(username: string, password: string): AppUser | null {
  if (!username || !password) return null;
  const user = findUserByUsername(username);
  if (!user) return null;
  if (!safeEqual(password, user.password)) return null;
  return user;
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
  const username = typeof fields.username === "string" ? fields.username : "";
  const password = typeof fields.password === "string" ? fields.password : "";

  const user = verifyUserCredentials(username, password);
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Invalid username or password." }, { status: 401 }) };
  }

  return { ok: true, data: { user, body: fields } };
}
