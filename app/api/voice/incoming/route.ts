import { NextResponse, after } from "next/server";
import twilio from "twilio";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { findUserByPhoneNumber } from "@/lib/users";
import { lookupContactName } from "@/lib/callerName";
import { sendPush } from "@/lib/push";

// Requires Node's crypto module (via the twilio SDK's request validation),
// so this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

// How long the browser (and the forwarding phone, if one is configured) ring
// before the caller is let go.
const RING_TIMEOUT_SECONDS = 30;
// Hard ceiling on a single call's length, matching outbound calls.
const MAX_CALL_SECONDS = 4 * 60 * 60;

// Inbound calls are driven by Twilio, not by anything a browser can trigger,
// so this is purely a backstop against a flood - the signature check below is
// what actually establishes that a request is genuine.
const IP_RATE_LIMIT = 60;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;

const REQUIRED_ENV_VARS = ["TWILIO_AUTH_TOKEN", "PUBLIC_BASE_URL", "APP_USERS"] as const;

function xmlResponse(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { "Content-Type": "text/xml" } });
}

function sayAndHangup(message: string, status = 200) {
  const vr = new twilio.twiml.VoiceResponse();
  vr.say(message);
  vr.hangup();
  return xmlResponse(vr.toString(), status);
}

/**
 * The "A call comes in" webhook for every user's Twilio number.
 *
 * It rings that person's browser dialer, and - when they have a `forwardTo`
 * in APP_USERS - their own phone at the same time, whoever answers first
 * getting the call. The point of routing this through the app rather than
 * forwarding straight on the number is the caller ID: the <Dial> goes out as
 * the *original caller's* number, so both the dialer and the forwarding phone
 * show who is actually calling. Forwarding configured on the number itself
 * sends the call on under the Twilio number instead, which is why an incoming
 * call used to announce the user's own line back at them.
 */
export async function POST(req: Request) {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/voice/incoming] Missing required environment variable: ${key}`);
      return sayAndHangup("Server configuration error.", 500);
    }
  }

  const ip = getClientIp(req);
  if (!rateLimit(`voice-incoming:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS).allowed) {
    return sayAndHangup("Too many requests. Please try again later.", 429);
  }

  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  // Confirms the request genuinely came from Twilio and was not forged by
  // someone who found this URL - without it, anyone could make this app ring
  // a user's browser and phone. Twilio signs against the exact URL configured
  // on the number, which is what PUBLIC_BASE_URL spells out.
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const validationUrl = `${process.env.PUBLIC_BASE_URL}/api/voice/incoming`;
  const isValidSignature = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    validationUrl,
    params,
  );
  if (!isValidSignature) {
    console.warn("[api/voice/incoming] Rejected request with invalid Twilio signature.");
    return new NextResponse("Forbidden", { status: 403 });
  }

  // `To` is the Twilio number that was dialled, which is the only thing
  // saying whose call this is.
  const calledNumber = normalizePhoneNumber(params.To ?? "");
  const user = isValidE164(calledNumber) ? findUserByPhoneNumber(calledNumber) : undefined;
  if (!user) {
    console.warn(`[api/voice/incoming] Call to a number not in APP_USERS: ${params.To}`);
    return sayAndHangup("This number is not in service.");
  }

  const caller = normalizePhoneNumber(params.From ?? "");

  // Tell this person's devices who is calling, while the phone is still
  // ringing. `after` runs it once the TwiML has already gone back to
  // Twilio, so looking up a contact name never delays the call itself.
  //
  // This is the part that answers "who is this?" before the call is
  // picked up. The forwarded leg reaching their own phone can only ever
  // show one number, and a browser tab that is closed shows nothing at
  // all - the notification is what works in both cases.
  after(async () => {
    try {
      const name = isValidE164(caller) ? await lookupContactName(user.username, caller) : undefined;
      const who = name ?? (isValidE164(caller) ? caller : "Unknown number");
      await sendPush(user.username, {
        kind: "call",
        title: `${who} is calling`,
        body: name ? `${caller} · on ${user.phoneNumber}` : `on your line ${user.phoneNumber}`,
        number: isValidE164(caller) ? caller : "",
      });
    } catch (err) {
      console.warn("[api/voice/incoming] Could not send the call notification:", err);
    }
  });

  const vr = new twilio.twiml.VoiceResponse();
  const dial = vr.dial({
    // Show whoever answers the real caller, not this user's own number.
    // Twilio permits the inbound caller's own number as the caller ID on a
    // call that arrived over the PSTN - that is what ordinary call
    // forwarding does. A withheld or malformed caller ID is not a valid
    // value, so those calls fall back to the user's own number (the call
    // still goes through; it just can't say who it is from).
    callerId: isValidE164(caller) ? caller : user.phoneNumber,
    timeout: RING_TIMEOUT_SECONDS,
    timeLimit: MAX_CALL_SECONDS,
    // The caller hears real ringing while we ring, and the call only counts
    // as answered once a person actually picks up - without this Twilio
    // answers the call immediately and the caller hears silence.
    answerOnBridge: true,
  });

  // The browser dialer. If nobody is signed in on it, this branch simply
  // fails to connect and the <Number> below (when configured) still rings.
  dial.client(user.identity);
  if (user.forwardTo) dial.number(user.forwardTo);

  return xmlResponse(vr.toString());
}
