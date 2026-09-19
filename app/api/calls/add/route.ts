import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import {
  ConferenceUserError,
  getConferenceClient,
  callBelongsToIdentity,
  ensureConference,
  addParticipantRecord,
  resolveConferenceSid,
} from "@/lib/conference";

// Requires Node's crypto module (via requireUser / the twilio SDK), so
// this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";
// The conference upgrade waits on Twilio to move both legs, which can take a
// few seconds - well past a 10s default if anything is slow.
export const maxDuration = 30;

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_USERS",
] as const;

// Dials a new number into the same call as a live call, upgrading a plain
// 2-party call into a conference if it isn't one already (see
// lib/conference.ts). The original two parties keep talking uninterrupted
// while the new one rings in.
export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "calls-add",
    limit: 15,
    windowMs: 5 * 60 * 1000,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const browserCallSid = typeof fields.browserCallSid === "string" ? fields.browserCallSid : "";
  const to = normalizePhoneNumber(typeof fields.to === "string" ? fields.to : "");

  if (!browserCallSid || !browserCallSid.startsWith("CA")) {
    return NextResponse.json({ error: "Invalid call." }, { status: 400 });
  }
  if (!isValidE164(to)) {
    return NextResponse.json(
      { error: "Enter the number in international format, e.g. +12065551234" },
      { status: 400 },
    );
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

    // endConferenceOnExit is deliberately false here (unlike the original
    // two legs) - this person leaving shouldn't end the call for everyone
    // else still on it.
    const participant = await client.conferences(conferenceSid).participants.create({
      from: user.phoneNumber,
      to,
      endConferenceOnExit: false,
      startConferenceOnEnter: true,
      beep: "true",
      earlyMedia: true,
      timeout: 30,
    });

    await addParticipantRecord(client, browserCallSid, participant.callSid, to);

    return NextResponse.json({ ok: true, callSid: participant.callSid });
  } catch (err) {
    if (err instanceof ConferenceUserError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[api/calls/add] Failed:", err);
    return NextResponse.json({ error: "Failed to add the call." }, { status: 502 });
  }
}
