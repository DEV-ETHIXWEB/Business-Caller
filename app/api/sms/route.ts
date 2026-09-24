import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import twilio from "twilio";
import { put, list, del } from "@vercel/blob";
import { requireUser } from "@/lib/auth";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";

// Requires Node's crypto module (via requireUser / the twilio SDK), so
// this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";
// Uploading an attachment and handing it to Twilio takes longer than a
// plain text.
export const maxDuration = 30;

// A generous cap (~10 SMS segments) - not a hard Twilio limit, just a sane
// upper bound so a stray paste can't balloon into a huge multi-segment send.
const MAX_MESSAGE_LENGTH = 1600;

// Attachments (voice notes and photos) go out as MMS. The client shrinks
// photos and encodes voice notes small; this is the hard backstop. It stays
// under Vercel's ~4.5MB request limit once base64 is counted.
const MAX_MEDIA_BYTES = 3 * 1024 * 1024;

const MEDIA_TYPES: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/3gpp": "3gp",
  "audio/amr": "amr",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};

// Old uploads are only needed for the moment Twilio fetches them at send
// time, so they are swept out after a few days.
const MEDIA_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

function parseMediaDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:([a-zA-Z0-9/+.-]+)(?:;[a-zA-Z0-9=.,_ -]+)*;base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!(mime in MEDIA_TYPES)) return null;
  return { mime, buffer: Buffer.from(match[2], "base64") };
}

async function sweepOldMedia() {
  try {
    const { blobs } = await list({ prefix: "outgoing/", limit: 200 });
    const stale = blobs.filter((b) => Date.now() - b.uploadedAt.getTime() > MEDIA_RETENTION_MS);
    if (stale.length) await del(stale.map((b) => b.url));
  } catch (err) {
    console.warn("[api/sms] Media sweep failed:", err);
  }
}

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
  const mediaField = typeof fields.media === "string" ? fields.media : "";
  if (!message && !mediaField) {
    return NextResponse.json({ error: "Message cannot be empty." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).` },
      { status: 400 },
    );
  }

  let media: { mime: string; buffer: Buffer } | null = null;
  if (mediaField) {
    media = parseMediaDataUrl(mediaField);
    if (!media) {
      return NextResponse.json({ error: "Unsupported attachment type." }, { status: 400 });
    }
    if (media.buffer.byteLength === 0 || media.buffer.byteLength > MAX_MEDIA_BYTES) {
      return NextResponse.json({ error: "The attachment is too large. Try a shorter recording or a smaller photo." }, { status: 400 });
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error("[api/sms] Missing required environment variable: BLOB_READ_WRITE_TOKEN");
      return NextResponse.json({ error: "Server misconfiguration. Please contact the administrator." }, { status: 500 });
    }
  }

  const client = twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });

  try {
    // Twilio needs a public link to fetch an attachment from, so it is
    // parked in Blob storage first (under an unguessable name).
    let mediaUrl: string[] | undefined;
    if (media) {
      const name = `outgoing/${user.username}-${Date.now()}-${randomUUID()}.${MEDIA_TYPES[media.mime]}`;
      const blob = await put(name, media.buffer, { access: "public", contentType: media.mime });
      mediaUrl = [blob.url];
      if (Math.random() < 0.1) void sweepOldMedia();
    }

    // Sends from this logged-in user's own number, not a single shared one.
    const sms = await client.messages.create({
      to: destination,
      from: user.phoneNumber,
      ...(message ? { body: message } : {}),
      ...(mediaUrl ? { mediaUrl } : {}),
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
