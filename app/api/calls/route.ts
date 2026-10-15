import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireUser } from "@/lib/auth";
import type { CallLogEntry } from "@/lib/callLog";

// Requires Node's crypto module (via requireUser / the twilio SDK), so
// this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const IP_RATE_WINDOW_MS = 5 * 60 * 1000;
const FETCH_LIMIT = 100;

const REQUIRED_ENV_VARS = ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "APP_USERS"] as const;

function getClient() {
  return twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });
}

// Twilio's Call resource only ever names the browser side of an outbound
// leg as "client:dialer-<username>", never the real Twilio number - so the
// "with" number for an outbound call is `to`, and for an inbound call is
// `from`. Read-only against Twilio, fetched whenever the Calls tab loads
// (not polled continuously - a call history doesn't need second-by-second
// freshness the way an open text thread does).
export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "calls",
    limit: 30,
    windowMs: IP_RATE_WINDOW_MS,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user } = auth.data;

  const client = getClient();
  const ourNumber = user.phoneNumber;

  try {
    const [outbound, inbound] = await Promise.all([
      client.calls.list({ from: ourNumber, limit: FETCH_LIMIT }),
      client.calls.list({ to: ourNumber, limit: FETCH_LIMIT }),
    ]);

    const bySid = new Map<string, CallLogEntry>();
    for (const c of outbound) {
      // Everyone in APP_USERS shares one Twilio account, so calling a
      // colleague's number leaves two Call records with the same `from` and
      // `to`: the leg that left our number, and the one that arrived at
      // theirs. Both come back from the query above, which showed the one
      // call twice. Only our own side of a call belongs in our history -
      // the colleague's copy is a row in *their* history.
      if (c.direction === "inbound") continue;
      bySid.set(c.sid, {
        sid: c.sid,
        direction: "outbound",
        with: c.to,
        status: c.status,
        durationSeconds: Number(c.duration) || 0,
        at: (c.startTime ?? c.dateCreated ?? new Date()).getTime(),
      });
    }
    for (const c of inbound) {
      // The mirror of the rule above: a record that reached our number is
      // ours only when it is the inbound leg. The outbound leg a colleague's
      // call created on its way here is theirs.
      //
      // The <Dial> that rings the browser (and any forwarding phone) is an
      // outbound leg too, but its `to` is "client:<identity>" or the
      // forwarding number rather than our own, so it never reaches either
      // query - an answered incoming call still logs as the single inbound
      // row the caller actually made.
      if (c.direction !== "inbound") continue;
      if (bySid.has(c.sid)) continue;
      bySid.set(c.sid, {
        sid: c.sid,
        direction: "inbound",
        with: c.from,
        status: c.status,
        durationSeconds: Number(c.duration) || 0,
        at: (c.startTime ?? c.dateCreated ?? new Date()).getTime(),
      });
    }

    const calls = Array.from(bySid.values()).sort((a, b) => b.at - a.at);
    return NextResponse.json({ calls });
  } catch (err) {
    console.error("[api/calls] Twilio fetch failed:", err);
    return NextResponse.json({ error: "Failed to load call history." }, { status: 502 });
  }
}

// Deletes a single call history entry - permanently removed from Twilio's
// own records via its own delete call, not just hidden here.
export async function DELETE(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "calls-delete",
    limit: 30,
    windowMs: IP_RATE_WINDOW_MS,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const sid = typeof fields.sid === "string" ? fields.sid : "";
  if (!sid || !sid.startsWith("CA")) {
    return NextResponse.json({ error: "Invalid call id." }, { status: 400 });
  }

  const client = getClient();
  try {
    const call = await client.calls(sid).fetch();
    if (call.to !== user.phoneNumber && call.from !== user.phoneNumber) {
      return NextResponse.json({ error: "Call not found." }, { status: 404 });
    }
    await client.calls(sid).remove();
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("[api/calls] Twilio delete failed:", err);
    return NextResponse.json({ error: "Failed to delete call." }, { status: 502 });
  }
}
