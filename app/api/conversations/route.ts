import { NextResponse } from "next/server";
import twilio from "twilio";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { verifyAccessCode } from "@/lib/auth";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import type { ConversationSummary } from "@/lib/messageThread";

// Requires Node's crypto module (via verifyAccessCode / the twilio SDK),
// so this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

// Read-only against Twilio, fetched once whenever the Messages panel's
// conversation list is shown (not polled continuously like /api/messages).
const IP_RATE_LIMIT = 30;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;
const FETCH_LIMIT = 100;

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
      console.error(`[api/conversations] Missing required environment variable: ${key}`);
      return NextResponse.json(
        { error: "Server misconfiguration. Please contact the administrator." },
        { status: 500 },
      );
    }
  }

  const ip = getClientIp(req);
  const limit = rateLimit(`conversations:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS);
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

  const client = twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });
  const ourNumber = process.env.TWILIO_PHONE_NUMBER!;

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
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/conversations] Missing required environment variable: ${key}`);
      return NextResponse.json(
        { error: "Server misconfiguration. Please contact the administrator." },
        { status: 500 },
      );
    }
  }

  const ip = getClientIp(req);
  const limit = rateLimit(`conversations-delete:${ip}`, 15, IP_RATE_WINDOW_MS);
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
