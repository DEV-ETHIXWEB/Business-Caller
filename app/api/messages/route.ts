import { NextResponse } from "next/server";
import twilio from "twilio";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import { verifyAccessCode } from "@/lib/auth";
import type { ThreadMessage } from "@/lib/messageThread";

// Requires Node's crypto module (via verifyAccessCode / the twilio SDK),
// so this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

// This endpoint is polled every few seconds while a conversation is open in
// the Messages panel, so it needs a much higher ceiling than the send/token
// endpoints. It's read-only against Twilio (no SMS is sent or received by
// calling this), so a generous limit costs nothing but a little API quota.
const IP_RATE_LIMIT = 90;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;
const THREAD_PAGE_SIZE = 50;

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_PHONE_NUMBER",
  "APP_ACCESS_CODE",
] as const;

export async function POST(req: Request) {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/messages] Missing required environment variable: ${key}`);
      return NextResponse.json(
        { error: "Server misconfiguration. Please contact the administrator." },
        { status: 500 },
      );
    }
  }

  const ip = getClientIp(req);
  const limit = rateLimit(`messages:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes and try again." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(limit.retryAfterMs / 1000).toString() },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const accessCode = typeof fields.accessCode === "string" ? fields.accessCode : "";
  if (!accessCode || !verifyAccessCode(accessCode, process.env.APP_ACCESS_CODE!)) {
    return NextResponse.json({ error: "Invalid access code." }, { status: 401 });
  }

  const withNumber = normalizePhoneNumber(typeof fields.with === "string" ? fields.with : "");
  if (!isValidE164(withNumber)) {
    return NextResponse.json({ error: "Invalid number." }, { status: 400 });
  }

  const client = twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });

  const ourNumber = process.env.TWILIO_PHONE_NUMBER!;

  try {
    // Twilio records every inbound and outbound message against the account
    // regardless of any webhook configuration, so reading it back here is
    // the actual source of truth for "did they reply" - no separate
    // database or inbound webhook needed. list() only filters by a single
    // `to`/`from` at a time, so a two-party thread needs both directions
    // fetched and merged.
    const [outbound, inbound] = await Promise.all([
      client.messages.list({ from: ourNumber, to: withNumber, limit: THREAD_PAGE_SIZE }),
      client.messages.list({ from: withNumber, to: ourNumber, limit: THREAD_PAGE_SIZE }),
    ]);

    const messages: ThreadMessage[] = [...outbound, ...inbound]
      .map((m) => ({
        sid: m.sid,
        direction: (m.direction === "inbound" ? "inbound" : "outbound") as ThreadMessage["direction"],
        body: m.body,
        status: m.status,
        at: (m.dateCreated ?? new Date()).getTime(),
      }))
      .sort((a, b) => a.at - b.at);

    return NextResponse.json({ messages });
  } catch (err) {
    console.error("[api/messages] Twilio fetch failed:", err);
    return NextResponse.json({ error: "Failed to load messages." }, { status: 502 });
  }
}
