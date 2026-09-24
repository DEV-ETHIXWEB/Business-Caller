import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireUser } from "@/lib/auth";

// Requires Node's crypto module (via requireUser / the twilio SDK), so
// this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const REQUIRED_ENV_VARS = ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "APP_USERS"] as const;
const MESSAGE_SID_PATTERN = /^SM[0-9a-fA-F]{32}$/;

// "Message info": what Twilio itself recorded about one text (delivery status,
// when it was sent, how many SMS segments it used, and what it cost).
export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "message-info",
    limit: 60,
    windowMs: 5 * 60 * 1000,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const sid = typeof fields.sid === "string" ? fields.sid : "";
  if (!MESSAGE_SID_PATTERN.test(sid)) {
    return NextResponse.json({ error: "Invalid message SID." }, { status: 400 });
  }

  const client = twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });

  try {
    const m = await client.messages(sid).fetch();
    // All users share one Twilio account, so confirm this text belongs to the
    // caller's own number before revealing anything about it.
    if (m.to !== user.phoneNumber && m.from !== user.phoneNumber) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }
    return NextResponse.json({
      sid: m.sid,
      direction: m.direction,
      status: m.status,
      from: m.from,
      to: m.to,
      dateCreated: m.dateCreated?.getTime() ?? null,
      dateSent: m.dateSent?.getTime() ?? null,
      dateUpdated: m.dateUpdated?.getTime() ?? null,
      segments: Number(m.numSegments) || null,
      media: Number(m.numMedia) || 0,
      price: m.price ?? null,
      priceUnit: m.priceUnit ?? null,
      errorCode: m.errorCode ?? null,
      errorMessage: m.errorMessage ?? null,
    });
  } catch (err) {
    console.error("[api/messages/info] Twilio fetch failed:", err);
    return NextResponse.json({ error: "Failed to load message info." }, { status: 502 });
  }
}
