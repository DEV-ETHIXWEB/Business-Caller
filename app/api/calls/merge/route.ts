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

// Takes every held participant on this call off hold at once - "merging"
// everyone back into one live conversation.
export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "calls-merge",
    limit: 15,
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
      // Never converted to a conference (Hold/Add Call never used) - there
      // is nothing to merge, which isn't an error.
      return NextResponse.json({ ok: true });
    }
    const conferenceSid = await resolveConferenceSid(client, record.conferenceName);
    if (!conferenceSid) {
      return NextResponse.json({ error: "Could not reach the conference." }, { status: 502 });
    }
    const participants = await client.conferences(conferenceSid).participants.list();
    await Promise.all(
      participants
        .filter((p) => p.hold)
        .map((p) => client.conferences(conferenceSid).participants(p.callSid).update({ hold: false })),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/calls/merge] Failed:", err);
    return NextResponse.json({ error: "Failed to merge." }, { status: 502 });
  }
}
