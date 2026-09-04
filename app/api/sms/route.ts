import { NextResponse } from "next/server";
import twilio from "twilio";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import { verifyAccessCode } from "@/lib/auth";

// Requires Node's crypto module (via verifyAccessCode / the twilio SDK),
// so this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

// Same gate as /api/token: the browser re-sends the access code with every
// request rather than relying on a server-side session, so there is no
// session store to manage.
const IP_RATE_LIMIT = 20;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;

// A generous cap (~10 SMS segments) - not a hard Twilio limit, just a sane
// upper bound so a stray paste can't balloon into a huge multi-segment send.
const MAX_MESSAGE_LENGTH = 1600;

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
      console.error(`[api/sms] Missing required environment variable: ${key}`);
      return NextResponse.json(
        { error: "Server misconfiguration. Please contact the administrator." },
        { status: 500 },
      );
    }
  }

  const ip = getClientIp(req);
  const limit = rateLimit(`sms:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS);
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

  const destination = normalizePhoneNumber(typeof fields.to === "string" ? fields.to : "");
  if (!isValidE164(destination)) {
    return NextResponse.json(
      { error: "Enter the number in international format, e.g. +12065551234" },
      { status: 400 },
    );
  }

  const message = typeof fields.message === "string" ? fields.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Message cannot be empty." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).` },
      { status: 400 },
    );
  }

  const client = twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });

  try {
    const sms = await client.messages.create({
      to: destination,
      from: process.env.TWILIO_PHONE_NUMBER!,
      body: message,
    });
    return NextResponse.json({ sid: sms.sid, status: sms.status });
  } catch (err) {
    console.error("[api/sms] Twilio send failed:", err);
    const reason =
      err instanceof Error
        ? err.message
        : "Failed to send message. Check that SMS is enabled on this Twilio number.";
    return NextResponse.json({ error: reason }, { status: 502 });
  }
}
