import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireUser } from "@/lib/auth";
import { isOurCopy } from "@/lib/messageThread";
import { byUrgencyThenRecency, parseLead, type Lead } from "@/lib/leads";

// Requires Node's crypto module (via requireUser / the twilio SDK), so
// this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const IP_RATE_LIMIT = 60;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;
// How far back to look. The summaries arrive at roughly a handful a day, so
// this covers a few weeks - enough that nothing recent is missed, while
// staying one Twilio page.
const FETCH_LIMIT = 400;

const REQUIRED_ENV_VARS = ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "APP_USERS"] as const;

/**
 * The jobs that came in while nobody was on the phone.
 *
 * When the answering service takes a call it texts over a summary of what
 * the caller wanted. Those are ordinary inbound texts, so they were only
 * ever visible as walls of plain text inside a chat thread - everything
 * needed to act on a job was there, and none of it was usable at a glance.
 *
 * This reads the recent inbound texts to this person's number and returns
 * the ones that are lead summaries, parsed. It deliberately does not care
 * which number they came from: the answering service's number is not
 * configured anywhere, and hard-coding it would break the day it changes.
 * The shape of the message is what identifies it.
 */
export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "leads",
    limit: IP_RATE_LIMIT,
    windowMs: IP_RATE_WINDOW_MS,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user } = auth.data;

  const client = twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });

  try {
    const received = await client.messages.list({ to: user.phoneNumber, limit: FETCH_LIMIT });

    const leads: Lead[] = [];
    const seen = new Set<string>();

    for (const m of received) {
      // Everyone shares one Twilio account, so a colleague's outbound copy
      // can show up on this query too - same rule as the message thread.
      if (!isOurCopy(m, user.phoneNumber)) continue;
      if (!m.body) continue;

      const lead = parseLead({
        sid: m.sid,
        at: (m.dateCreated ?? new Date()).getTime(),
        body: m.body,
        toNumber: m.to ?? user.phoneNumber,
        fromNumber: m.from ?? "",
      });
      if (!lead) continue;

      // The same summary is sometimes texted more than once. One job should
      // appear once, so later copies of an identical summary are dropped.
      const fingerprint = lead.raw.replace(/\s+/g, " ").trim();
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      leads.push(lead);
    }

    leads.sort(byUrgencyThenRecency);
    return NextResponse.json({ leads, truncated: received.length >= FETCH_LIMIT });
  } catch (err) {
    console.error("[api/leads] Twilio fetch failed:", err);
    return NextResponse.json({ error: "Failed to load leads." }, { status: 502 });
  }
}
