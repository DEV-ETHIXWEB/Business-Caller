import { NextResponse, after } from "next/server";
import twilio from "twilio";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { findUserByPhoneNumber } from "@/lib/users";
import { lookupContactName } from "@/lib/callerName";
import { isBlocked, readCallRules } from "@/lib/callRules";
import { sendPush } from "@/lib/push";

// Requires Node's crypto module (via the twilio SDK's request validation),
// so this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const IP_RATE_LIMIT = 120;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;
const REQUIRED_ENV_VARS = ["TWILIO_AUTH_TOKEN", "PUBLIC_BASE_URL", "APP_USERS"] as const;

// How much of the text to put in the notification. Enough to know whether
// it needs answering now; not so much that the whole message sits on a
// lock screen for anyone nearby to read.
const PREVIEW_LENGTH = 140;

// Twilio treats any TwiML we return as a reply to send back. An empty
// <Response/> is how you say "received, say nothing" - anything else would
// text the sender automatically.
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function xmlResponse(body = EMPTY_TWIML, status = 200) {
  return new NextResponse(body, { status, headers: { "Content-Type": "text/xml" } });
}

function preview(body: string, mediaCount: number): string {
  const text = body.replace(/\s+/g, " ").trim();
  if (text) return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
  if (mediaCount > 0) return mediaCount === 1 ? "Sent an attachment" : `Sent ${mediaCount} attachments`;
  return "New message";
}

/**
 * The "A message comes in" webhook for each number.
 *
 * The app reads message history straight from Twilio, so it does not need
 * this to know a text arrived - it will see it on the next poll. What it
 * needs this for is telling someone *now*, on a device where the app is
 * closed, who texted and what they said.
 *
 * It deliberately sends no reply. Twilio's own default for a number with
 * no webhook is to answer with a canned message, which is its own small
 * embarrassment on a business line.
 */
export async function POST(req: Request) {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/sms/incoming] Missing required environment variable: ${key}`);
      // Still an empty reply: a misconfigured server must not make the
      // sender receive an error message.
      return xmlResponse();
    }
  }

  const ip = getClientIp(req);
  if (!rateLimit(`sms-incoming:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS).allowed) {
    return xmlResponse();
  }

  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  // Without this, anyone who found the URL could make someone's phone buzz
  // with a notification about a text that never existed.
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const validationUrl = `${process.env.PUBLIC_BASE_URL}/api/sms/incoming`;
  if (!twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN!, signature, validationUrl, params)) {
    console.warn("[api/sms/incoming] Rejected request with invalid Twilio signature.");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const toNumber = normalizePhoneNumber(params.To ?? "");
  const user = isValidE164(toNumber) ? findUserByPhoneNumber(toNumber) : undefined;
  if (!user) {
    console.warn(`[api/sms/incoming] Text to a number not in APP_USERS: ${params.To}`);
    return xmlResponse();
  }

  const from = normalizePhoneNumber(params.From ?? "");
  const text = typeof params.Body === "string" ? params.Body : "";
  const mediaCount = Number(params.NumMedia) || 0;

  // Twilio gets its empty reply straight away; the notification goes out
  // behind it.
  after(async () => {
    try {
      // A blocked number gets no notification. The text itself still
      // arrives and is still billed - it reaches Twilio before this app
      // sees it, and nothing can change that - but it will not buzz anyone's
      // phone, and the chat stays hidden in the app.
      const rules = await readCallRules(user.username);
      if (isBlocked(rules, from)) return;

      const name = isValidE164(from) ? await lookupContactName(user.username, from) : undefined;
      await sendPush(user.username, {
        kind: "message",
        title: name ?? (isValidE164(from) ? from : "New message"),
        body: preview(text, mediaCount),
        number: isValidE164(from) ? from : "",
      });
    } catch (err) {
      console.warn("[api/sms/incoming] Could not send the message notification:", err);
    }
  });

  return xmlResponse();
}
