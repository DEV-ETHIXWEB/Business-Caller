import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireUser } from "@/lib/auth";

// Requires Node's crypto module (timingSafeEqual, and the twilio SDK's own
// use of Node APIs), so this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const TOKEN_TTL_SECONDS = 3600; // 1 hour

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_TWIML_APP_SID",
  "APP_USERS",
] as const;

export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "token",
    // Applies to every request, valid login or not, so a script can't
    // hammer this looking for a working username/password.
    limit: 15,
    windowMs: 5 * 60 * 1000,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user } = auth.data;

  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const accessToken = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_API_KEY_SID!,
    process.env.TWILIO_API_KEY_SECRET!,
    { identity: user.identity, ttl: TOKEN_TTL_SECONDS },
  );

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID!,
    // This browser dialer never receives calls, only places them.
    incomingAllow: false,
  });
  accessToken.addGrant(voiceGrant);

  return NextResponse.json({
    token: accessToken.toJwt(),
    identity: user.identity,
    ttlSeconds: TOKEN_TTL_SECONDS,
    phoneNumber: user.phoneNumber,
    label: user.label,
  });
}
