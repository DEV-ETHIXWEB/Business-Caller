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

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_USERS",
  "BLOB_READ_WRITE_TOKEN",
] as const;

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

  const client = getProfileClient();

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
    // this is deliberately not allowed to fail the upload.
    if (existing.avatarUrl && existing.avatarUrl !== blob.url) {
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
    if (existing.avatarUrl) {
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
