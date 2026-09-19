import { NextResponse } from "next/server";
import twilio from "twilio";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { conferenceJoinTwiml, getConferenceClient, readConferenceRecord } from "@/lib/conference";

// Requires Node's crypto module (via the twilio SDK's request validation),
// so this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const REQUIRED_ENV_VARS = ["TWILIO_AUTH_TOKEN", "PUBLIC_BASE_URL"] as const;
const IP_RATE_LIMIT = 200;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;

function xmlResponse(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { "Content-Type": "text/xml" } });
}

// Ending the call is what happened before this route existed (a <Dial>
// with nothing after it simply hangs up), so every path that isn't a
// deliberate Hold/Add Call upgrade returns exactly that - never an error
// that Twilio would announce to the caller as an "application error".
function hangup() {
  return xmlResponse("<Response><Hangup/></Response>");
}

// Twilio calls this when the <Dial> in app/api/voice/route.ts finishes,
// with the browser leg's own CallSid. Almost always that just means the
// call is over. The one exception: Hold/Add Call redirected the far leg
// into a conference (lib/conference.ts), which also ends this <Dial> - and
// then the browser leg has to follow it in rather than hang up.
export async function POST(req: Request) {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/voice/after-dial] Missing required environment variable: ${key}`);
      return hangup();
    }
  }

  const ip = getClientIp(req);
  if (!rateLimit(`after-dial:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS).allowed) {
    return hangup();
  }

  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  const signature = req.headers.get("x-twilio-signature") ?? "";
  const validationUrl = `${process.env.PUBLIC_BASE_URL}/api/voice/after-dial`;
  const isValidSignature = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    validationUrl,
    params,
  );
  if (!isValidSignature) {
    console.warn("[api/voice/after-dial] Rejected request with invalid Twilio signature.");
    return new NextResponse("Forbidden", { status: 403 });
  }

  // A permanent record of how each call's far leg finished (this route is
  // only reached when the far leg ended the <Dial>, not when the browser
  // hung up) - the one signal available for telling "the other side ended
  // it" from "we did" when a call ends unexpectedly.
  console.log(
    `[api/voice/after-dial] call=${params.CallSid} dialStatus=${params.DialCallStatus} dialDuration=${params.DialCallDuration}s`,
  );

  // A call that never connected (no-answer/busy/failed) can't be a Hold/Add
  // Call upgrade, so skip the lookup. Anything else is checked against the
  // record rather than trusting a specific DialCallStatus - Twilio's exact
  // status for "far leg was redirected away" isn't something to bet a
  // dropped call on; the record only exists if we deliberately upgraded.
  const neverConnected = ["no-answer", "busy", "failed"].includes(params.DialCallStatus ?? "");
  if (!neverConnected && params.CallSid) {
    try {
      const record = await readConferenceRecord(getConferenceClient(), params.CallSid);
      if (record) {
        return xmlResponse(conferenceJoinTwiml(record.conferenceName));
      }
    } catch (err) {
      console.error("[api/voice/after-dial] Could not read the conference record:", err);
    }
  }

  return hangup();
}
