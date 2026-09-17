import { NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { requireUser } from "@/lib/auth";
import { getProfileClient, readProfile, writeProfile } from "@/lib/profileStore";

// Requires Node's crypto module (via requireUser / the twilio SDK), so
// this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const IP_RATE_WINDOW_MS = 5 * 60 * 1000;

// The client resizes/compresses to well under this before uploading (see
// Dialer.tsx's canvas-based resize) - this is just a hard backstop against
// an oversized or malformed payload, not the primary size control.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// BLOB_READ_WRITE_TOKEN is deliberately not required here - it's only
// needed for the real-photo upload path below. Choosing a preset avatar is
// just a string written to Twilio Sync, so it works even before Blob
// storage is set up.
const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_USERS",
] as const;

const PRESET_COUNT = 5;

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const [, mime, base64] = match;
  if (!(mime in ALLOWED_TYPES)) return null;
  try {
    return { mime, buffer: Buffer.from(base64, "base64") };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "avatar-upload",
    limit: 10,
    windowMs: IP_RATE_WINDOW_MS,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const client = getProfileClient();

  // A preset ("generic person" icon in one of the app's brand color
  // themes) needs no image upload at all - just store the reference.
  if (typeof fields.preset === "number") {
    if (!Number.isInteger(fields.preset) || fields.preset < 0 || fields.preset >= PRESET_COUNT) {
      return NextResponse.json({ error: "Invalid preset." }, { status: 400 });
    }
    const avatarUrl = `preset:${fields.preset}`;
    try {
      const existing = await readProfile(client, user.username);
      await writeProfile(client, user.username, { avatarUrl });
      if (existing.avatarUrl && existing.avatarUrl.startsWith("http")) {
        del(existing.avatarUrl).catch((err) => {
          console.warn("[api/avatar] Failed to delete previous photo:", err);
        });
      }
      return NextResponse.json({ avatarUrl });
    } catch (err) {
      console.error("[api/avatar] Preset save failed:", err);
      return NextResponse.json({ error: "Failed to set avatar." }, { status: 502 });
    }
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("[api/avatar] Missing required environment variable: BLOB_READ_WRITE_TOKEN");
    return NextResponse.json(
      { error: "Server misconfiguration. Please contact the administrator." },
      { status: 500 },
    );
  }

  const image = typeof fields.image === "string" ? fields.image : "";
  if (!image) {
    return NextResponse.json({ error: "No image provided." }, { status: 400 });
  }

  const parsed = parseDataUrl(image);
  if (!parsed) {
    return NextResponse.json({ error: "Unsupported image format. Use PNG, JPEG, or WebP." }, { status: 400 });
  }
  if (parsed.buffer.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image is too large." }, { status: 400 });
  }

  try {
    const extension = ALLOWED_TYPES[parsed.mime];
    const blob = await put(`avatars/${user.username}-${Date.now()}.${extension}`, parsed.buffer, {
      access: "public",
      contentType: parsed.mime,
    });

    const existing = await readProfile(client, user.username);
    await writeProfile(client, user.username, { avatarUrl: blob.url });

    // Best-effort cleanup of the previous photo - failing to delete the old
    // blob leaves an orphaned file in storage but never breaks the app, so
    // this is deliberately not allowed to fail the upload. Skipped if the
    // previous avatar was a preset ("preset:N"), which has no blob to delete.
    if (existing.avatarUrl && existing.avatarUrl.startsWith("http") && existing.avatarUrl !== blob.url) {
      del(existing.avatarUrl).catch((err) => {
        console.warn("[api/avatar] Failed to delete previous photo:", err);
      });
    }

    return NextResponse.json({ avatarUrl: blob.url });
  } catch (err) {
    console.error("[api/avatar] Upload failed:", err);
    return NextResponse.json({ error: "Failed to upload photo." }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "avatar-delete",
    limit: 10,
    windowMs: IP_RATE_WINDOW_MS,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user } = auth.data;

  const client = getProfileClient();
  try {
    const existing = await readProfile(client, user.username);
    await writeProfile(client, user.username, { avatarUrl: undefined });
    if (existing.avatarUrl && existing.avatarUrl.startsWith("http")) {
      await del(existing.avatarUrl).catch((err) => {
        console.warn("[api/avatar] Failed to delete photo blob:", err);
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/avatar] Remove failed:", err);
    return NextResponse.json({ error: "Failed to remove photo." }, { status: 502 });
  }
}
