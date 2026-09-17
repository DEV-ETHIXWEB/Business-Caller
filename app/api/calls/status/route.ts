import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getConferenceClient, callBelongsToIdentity, readConferenceRecord, resolveConferenceSid } from "@/lib/conference";

// Requires Node's crypto module (via requireUser / the twilio SDK), so
// this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_USERS",
] as const;

// Polled by the UI while a call is active, to know whether it has been
// upgraded to a conference yet (Hold/Add Call used) and, if so, who else is
// on it and whether they're on hold - without the client ever needing to
// talk to Twilio's REST API directly.
export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "calls-status",
    limit: 60,
    windowMs: 5 * 60 * 1000,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const browserCallSid = typeof fields.browserCallSid === "string" ? fields.browserCallSid : "";
  if (!browserCallSid || !browserCallSid.startsWith("CA")) {
    return NextResponse.json({ error: "Invalid call." }, { status: 400 });
  }

  const client = getConferenceClient();
  const owns = await callBelongsToIdentity(client, browserCallSid, user.identity);
  if (!owns) {
    return NextResponse.json({ error: "Call not found." }, { status: 404 });
  }

  try {
    const record = await readConferenceRecord(client, browserCallSid);
    if (!record) {
      return NextResponse.json({ inConference: false, participants: [] });
    }
    const conferenceSid = await resolveConferenceSid(client, record.conferenceName);
    if (!conferenceSid) {
      return NextResponse.json({ inConference: true, participants: [] });
    }
    const twilioParticipants = await client.conferences(conferenceSid).participants.list();
    const participants = twilioParticipants
      .filter((p) => p.callSid !== browserCallSid)
      .map((p) => ({
        callSid: p.callSid,
        number: record.participants[p.callSid]?.number ?? "Unknown",
        onHold: p.hold,
      }));
    return NextResponse.json({ inConference: true, participants });
  } catch (err) {
    console.error("[api/calls/status] Failed:", err);
    return NextResponse.json({ error: "Failed to load call status." }, { status: 502 });
  }
}
