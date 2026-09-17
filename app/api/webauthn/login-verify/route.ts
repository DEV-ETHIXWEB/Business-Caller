import { NextResponse } from "next/server";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { getRpID, getExpectedOrigin } from "@/lib/webauthn";
import { getWebAuthnClient, readCredentials, writeCredentials } from "@/lib/webauthnStore";
import { findUserByUsername } from "@/lib/users";

export const runtime = "nodejs";

const IP_RATE_LIMIT = 20;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_USERS",
  "PUBLIC_BASE_URL",
] as const;

// The only "password" here is a cryptographic signature only the device
// that completed registration can produce, backed by Face ID / Touch ID /
// Windows Hello in its secure enclave. On success this hands back that
// user's real username and password, which the browser then uses exactly
// as if they'd been typed - nothing downstream of this needs to know
// biometrics were used.
export async function POST(req: Request) {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/webauthn/login-verify] Missing required environment variable: ${key}`);
      return NextResponse.json(
        { error: "Server misconfiguration. Please contact the administrator." },
        { status: 500 },
      );
    }
  }

  const ip = getClientIp(req);
  const limit = rateLimit(`webauthn-login:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS);
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
  const response = fields.response as AuthenticationResponseJSON | undefined;
  const expectedChallenge = typeof fields.expectedChallenge === "string" ? fields.expectedChallenge : "";

  const user = username ? findUserByUsername(username) : undefined;
  if (!user || !response || !response.id || !expectedChallenge) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const rpID = getRpID();
  const origin = getExpectedOrigin();
  if (!rpID || !origin) {
    return NextResponse.json(
      { error: "Server misconfiguration: PUBLIC_BASE_URL is not a valid URL." },
      { status: 500 },
    );
  }

  const client = getWebAuthnClient();
  const stored = await readCredentials(client, user.username);
  const match = stored.find((c) => c.id === response.id);
  if (!match) {
    return NextResponse.json(
      { error: "This device isn't set up for Face ID / Touch ID. Use the password instead." },
      { status: 401 },
    );
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: match.id,
        publicKey: new Uint8Array(Buffer.from(match.publicKey, "base64")),
        counter: match.counter,
        transports: match.transports,
      },
    });
  } catch (err) {
    console.error("[api/webauthn/login-verify] verification threw:", err);
    return NextResponse.json({ error: "Could not verify. Use the password instead." }, { status: 401 });
  }

  if (!verification.verified) {
    return NextResponse.json({ error: "Could not verify. Use the password instead." }, { status: 401 });
  }

  // Persist the updated signature counter - a later login reporting a
  // counter that hasn't increased is the standard signal of a cloned
  // authenticator, so this needs to be kept current.
  const next = stored.map((c) =>
    c.id === match.id ? { ...c, counter: verification.authenticationInfo.newCounter } : c,
  );
  await writeCredentials(client, user.username, next);

  return NextResponse.json({ username: user.username, password: user.password });
}
