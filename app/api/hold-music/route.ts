import { NextResponse } from "next/server";
import twilio from "twilio";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

// Requires Node's crypto module (via the twilio SDK's request validation),
// so this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const REQUIRED_ENV_VARS = ["TWILIO_AUTH_TOKEN", "PUBLIC_BASE_URL"] as const;
const IP_RATE_LIMIT = 120;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;

function xmlResponse(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { "Content-Type": "text/xml" } });
}

// A self-looping TwiML webhook Twilio calls (as a conference Participant's
// holdUrl) for as long as that participant is on hold - no audio file to
// host or license, just a spoken announcement repeated with a pause,
// looping via its own <Redirect> until Twilio stops asking (because the
// participant was taken off hold or left the call).
export async function POST(req: Request) {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/hold-music] Missing required environment variable: ${key}`);
      return xmlResponse("<Response><Hangup/></Response>", 500);
    }
  }

  const ip = getClientIp(req);
  const limited = rateLimit(`hold-music:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS);
  if (!limited.allowed) {
    return xmlResponse("<Response><Hangup/></Response>", 429);
  }

  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  const signature = req.headers.get("x-twilio-signature") ?? "";
  const validationUrl = `${process.env.PUBLIC_BASE_URL}/api/hold-music`;
  const isValidSignature = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    validationUrl,
    params,
  );
  if (!isValidSignature) {
    console.warn("[api/hold-music] Rejected request with invalid Twilio signature.");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const vr = new twilio.twiml.VoiceResponse();
  vr.say("You are on hold. Please wait.");
  vr.pause({ length: 8 });
  vr.redirect({ method: "POST" }, `${process.env.PUBLIC_BASE_URL}/api/hold-music`);
  return xmlResponse(vr.toString());
}
