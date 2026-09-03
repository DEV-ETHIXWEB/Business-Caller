import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import twilio from "twilio";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { AGENT_IDENTITY } from "@/lib/constants";

// Requires Node's crypto module (timingSafeEqual, and the twilio SDK's own
// use of Node APIs), so this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const TOKEN_TTL_SECONDS = 3600; // 1 hour

// Applies to every request to this endpoint, valid access code or not, so a
// script can't hammer it looking for a leaked/guessed code.
const IP_RATE_LIMIT = 15;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_TWIML_APP_SID",
  "APP_ACCESS_CODE",
] as const;

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(req: Request) {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/token] Missing required environment variable: ${key}`);
      return NextResponse.json(
        { error: "Server misconfiguration. Please contact the administrator." },
        { status: 500 },
      );
    }
  }

  const ip = getClientIp(req);
  const limit = rateLimit(`token:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS);
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

  const accessCode =
    typeof body === "object" && body !== null && "accessCode" in body
      ? String((body as Record<string, unknown>).accessCode ?? "")
      : "";

  if (!accessCode || !safeCompare(accessCode, process.env.APP_ACCESS_CODE!)) {
    return NextResponse.json({ error: "Invalid access code." }, { status: 401 });
  }

  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const accessToken = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_API_KEY_SID!,
    process.env.TWILIO_API_KEY_SECRET!,
    { identity: AGENT_IDENTITY, ttl: TOKEN_TTL_SECONDS },
  );

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID!,
    // This browser dialer never receives calls, only places them.
    incomingAllow: false,
  });
  accessToken.addGrant(voiceGrant);

  return NextResponse.json({
    token: accessToken.toJwt(),
    identity: AGENT_IDENTITY,
    ttlSeconds: TOKEN_TTL_SECONDS,
  });
}
