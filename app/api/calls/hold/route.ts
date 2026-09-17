import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getConferenceClient,
  callBelongsToIdentity,
  ensureConference,
  resolveConferenceSid,
} from "@/lib/conference";

// Requires Node's crypto module (via requireUser / the twilio SDK), so
// this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_USERS",
  "PUBLIC_BASE_URL",
] as const;

// Puts the other party on a live call on hold (or takes them off it). The
// very first Hold for a given call is what triggers ensureConference - see
// lib/conference.ts for why that conversion is lazy rather than always-on.
export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "calls-hold",
    limit: 30,
    windowMs: 5 * 60 * 1000,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const browserCallSid = typeof fields.browserCallSid === "string" ? fields.browserCallSid : "";
  const hold = fields.hold !== false;
  let participantCallSid = typeof fields.participantCallSid === "string" ? fields.participantCallSid : "";

  if (!browserCallSid || !browserCallSid.startsWith("CA")) {
    return NextResponse.json({ error: "Invalid call." }, { status: 400 });
  }

  const client = getConferenceClient();

  const owns = await callBelongsToIdentity(client, browserCallSid, user.identity);
  if (!owns) {
    return NextResponse.json({ error: "Call not found." }, { status: 404 });
  }

  try {
    const record = await ensureConference(client, browserCallSid);
    const conferenceSid = await resolveConferenceSid(client, record.conferenceName);
    if (!conferenceSid) {
      return NextResponse.json({ error: "Could not reach the conference." }, { status: 502 });
    }

    if (!participantCallSid) {
      const ids = Object.keys(record.participants);
      if (ids.length !== 1) {
        return NextResponse.json({ error: "Specify which call to hold." }, { status: 400 });
      }
      [participantCallSid] = ids;
    }

    await client
      .conferences(conferenceSid)
      .participants(participantCallSid)
      .update(
        hold
          ? { hold: true, holdUrl: `${process.env.PUBLIC_BASE_URL}/api/hold-music`, holdMethod: "POST" }
          : { hold: false },
      );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/calls/hold] Failed:", err);
    return NextResponse.json({ error: "Failed to update hold." }, { status: 502 });
  }
}
