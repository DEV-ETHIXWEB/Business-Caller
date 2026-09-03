import { NextResponse } from "next/server";
import twilio from "twilio";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { AGENT_IDENTITY } from "@/lib/constants";

// Requires Node's crypto module (via the twilio SDK's request validation),
// so this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

// Twilio reports browser-SDK callers as "client:<identity>" in From.
const EXPECTED_FROM = `client:${AGENT_IDENTITY}`;

// Hard ceiling on a single call's length, in case of a stuck/forgotten call.
const MAX_CALL_SECONDS = 4 * 60 * 60; // 4 hours
const RING_TIMEOUT_SECONDS = 30;

// Twilio calls this endpoint once per call attempt; a real abuse attempt
// would come from a stolen/guessed Access Token hitting Device.connect()
// repeatedly, so this is a coarse backstop, not the primary defense (that's
// the signature check + identity check below).
const IP_RATE_LIMIT = 30;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;

const REQUIRED_ENV_VARS = ["TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "PUBLIC_BASE_URL"] as const;

function xmlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

function sayAndHangup(message: string, status = 200) {
  const vr = new twilio.twiml.VoiceResponse();
  vr.say(message);
  vr.hangup();
  return xmlResponse(vr.toString(), status);
}

export async function POST(req: Request) {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/voice] Missing required environment variable: ${key}`);
      return sayAndHangup("Server configuration error.", 500);
    }
  }

  const ip = getClientIp(req);
  const limited = rateLimit(`voice:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS);
  if (!limited.allowed) {
    return sayAndHangup("Too many requests. Please try again later.", 429);
  }

  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  // Confirms this request genuinely came from Twilio and was not forged by
  // a third party who found this URL. Uses the exact public URL this
  // endpoint is configured with in the Twilio Console (see PUBLIC_BASE_URL),
  // since Twilio signs against that URL, not whatever a proxy reports.
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const validationUrl = `${process.env.PUBLIC_BASE_URL}/api/voice`;
  const isValidSignature = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    validationUrl,
    params,
  );

  if (!isValidSignature) {
    console.warn("[api/voice] Rejected request with invalid Twilio signature.");
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Belt-and-suspenders: only the identity our own token endpoint issues
  // is allowed to place a call through this app.
  if (params.From !== EXPECTED_FROM) {
    console.warn(`[api/voice] Rejected request from unexpected identity: ${params.From}`);
    return sayAndHangup("Unauthorized caller.", 403);
  }

  const destination = normalizePhoneNumber(params.To ?? "");
  if (!isValidE164(destination)) {
    console.warn(`[api/voice] Rejected invalid destination number: ${params.To}`);
    return sayAndHangup(
      "The number you entered is not valid. Please use international format, for example plus 1 555 123 4567.",
    );
  }

  const vr = new twilio.twiml.VoiceResponse();
  const dial = vr.dial({
    callerId: process.env.TWILIO_PHONE_NUMBER,
    timeout: RING_TIMEOUT_SECONDS,
    timeLimit: MAX_CALL_SECONDS,
  });
  dial.number(destination);

  return xmlResponse(vr.toString());
}
