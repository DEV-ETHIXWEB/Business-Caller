import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireUser } from "@/lib/auth";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";

// Requires Node's crypto module (via requireUser / the twilio SDK), so
// this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

// A generous cap (~10 SMS segments) - not a hard Twilio limit, just a sane
// upper bound so a stray paste can't balloon into a huge multi-segment send.
const MAX_MESSAGE_LENGTH = 1600;

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "APP_USERS",
] as const;

export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "sms",
    limit: 20,
    windowMs: 5 * 60 * 1000,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

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
    // Sends from this logged-in user's own number, not a single shared one.
    const sms = await client.messages.create({
      to: destination,
      from: user.phoneNumber,
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
