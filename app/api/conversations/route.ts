import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireUser } from "@/lib/auth";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import type { ConversationSummary } from "@/lib/messageThread";

// Requires Node's crypto module (via requireUser / the twilio SDK), so
// this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

// Read-only against Twilio, fetched once whenever the Messages panel's
// conversation list is shown (not polled continuously like /api/messages).
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;
const FETCH_LIMIT = 100;

const REQUIRED_ENV_VARS = ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "APP_USERS"] as const;

export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "conversations",
    limit: 30,
    windowMs: IP_RATE_WINDOW_MS,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user } = auth.data;

  const client = twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });
  const ourNumber = user.phoneNumber;

  try {
    const [sent, received] = await Promise.all([
      client.messages.list({ from: ourNumber, limit: FETCH_LIMIT }),
      client.messages.list({ to: ourNumber, limit: FETCH_LIMIT }),
    ]);

    const byNumber = new Map<string, ConversationSummary>();
    for (const m of [...sent, ...received]) {
      const isInbound = m.direction === "inbound";
      const counterpart = isInbound ? m.from : m.to;
      if (!counterpart) continue;

      const at = (m.dateCreated ?? new Date()).getTime();
      const existing = byNumber.get(counterpart);
      if (!existing || at > existing.lastAt) {
        byNumber.set(counterpart, {
          number: counterpart,
          lastBody: m.body,
          lastDirection: isInbound ? "inbound" : "outbound",
          lastAt: at,
        });
      }
    }

    const conversations = Array.from(byNumber.values()).sort((a, b) => b.lastAt - a.lastAt);
    return NextResponse.json({ conversations });
  } catch (err) {
    console.error("[api/conversations] Twilio fetch failed:", err);
    return NextResponse.json({ error: "Failed to load conversations." }, { status: 502 });
  }
}

// Deletes every message exchanged with one number - i.e. the whole
// conversation. Each message is permanently removed from Twilio's records
// via its own delete call; there is nothing to undo this with.
export async function DELETE(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "conversations-delete",
    limit: 15,
    windowMs: IP_RATE_WINDOW_MS,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const withNumber = normalizePhoneNumber(typeof fields.with === "string" ? fields.with : "");
  if (!isValidE164(withNumber)) {
    return NextResponse.json({ error: "Invalid number." }, { status: 400 });
  }

  const client = twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });
  const ourNumber = user.phoneNumber;

  try {
    const [sent, received] = await Promise.all([
      client.messages.list({ from: ourNumber, to: withNumber, limit: FETCH_LIMIT }),
      client.messages.list({ from: withNumber, to: ourNumber, limit: FETCH_LIMIT }),
    ]);

    const all = [...sent, ...received];
    const results = await Promise.allSettled(all.map((m) => client.messages(m.sid).remove()));
    const deleted = results.filter((r) => r.status === "fulfilled").length;

    return NextResponse.json({ deleted, total: all.length });
  } catch (err) {
    console.error("[api/conversations] Twilio delete failed:", err);
    return NextResponse.json({ error: "Failed to delete conversation." }, { status: 502 });
  }
}
