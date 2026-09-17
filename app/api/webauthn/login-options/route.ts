import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { getRpID } from "@/lib/webauthn";
import { getWebAuthnClient, readCredentials } from "@/lib/webauthnStore";
import { findUserByUsername } from "@/lib/users";

export const runtime = "nodejs";

const IP_RATE_LIMIT = 30;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_USERS",
  "PUBLIC_BASE_URL",
] as const;

// No password here - this is the pre-unlock path, and a username is all
// that's needed to know whose credentials to look up. Populating
// allowCredentials (with each credential's stored transports, e.g.
// "internal") is what lets the browser skip its full "how do you want to
// sign in" picker - QR code for another device, USB security key - and go
// straight to this device's Face ID/Touch ID/Windows Hello prompt. This
// does mean an unauthenticated caller who already knows a username can
// learn how many credentials it has and their opaque IDs; those IDs grant
// no ability to authenticate without the matching private key, which never
// leaves the authenticator, so this is a standard, low-risk tradeoff for
// the much better sign-in experience. An unknown username behaves
// identically to a known one with zero devices, so this can't be used to
// discover which usernames exist.
export async function POST(req: Request) {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/webauthn/login-options] Missing required environment variable: ${key}`);
      return NextResponse.json(
        { error: "Server misconfiguration. Please contact the administrator." },
        { status: 500 },
      );
    }
  }

  const ip = getClientIp(req);
  const limit = rateLimit(`webauthn-login-opts:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes and try again." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(limit.retryAfterMs / 1000).toString() },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const username = typeof fields.username === "string" ? fields.username : "";
  if (!username) {
    return NextResponse.json({ error: "Enter your username first." }, { status: 400 });
  }

  const rpID = getRpID();
  if (!rpID) {
    return NextResponse.json(
      { error: "Server misconfiguration: PUBLIC_BASE_URL is not a valid URL." },
      { status: 500 },
    );
  }

  const user = findUserByUsername(username);
  const stored = user ? await readCredentials(getWebAuthnClient(), user.username) : [];

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: stored.map((c) => ({ id: c.id, transports: c.transports })),
  });

  return NextResponse.json({ options });
}
