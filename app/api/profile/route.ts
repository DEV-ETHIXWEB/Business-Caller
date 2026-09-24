import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getProfileClient,
  writeProfile,
  cleanText,
  MAX_ABOUT_LENGTH,
  MAX_STATUS_TEXT_LENGTH,
  MAX_STATUS_EMOJI_LENGTH,
  type Profile,
} from "@/lib/profileStore";

// Requires Node's crypto module (via requireUser / the twilio SDK), so
// this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_USERS",
] as const;

// Saves the signed-in person's "About" line and mood status. Either field
// can be sent on its own; an empty value clears it. The photo has its own
// route (/api/avatar) and is never touched here.
export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "profile-update",
    limit: 30,
    windowMs: 5 * 60 * 1000,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const patch: Partial<Profile> = {};

  if ("about" in fields) {
    if (typeof fields.about !== "string") {
      return NextResponse.json({ error: "Invalid about text." }, { status: 400 });
    }
    if (fields.about.length > MAX_ABOUT_LENGTH * 2) {
      return NextResponse.json({ error: `About must be ${MAX_ABOUT_LENGTH} characters or fewer.` }, { status: 400 });
    }
    patch.about = cleanText(fields.about, MAX_ABOUT_LENGTH) || undefined;
  }

  if ("status" in fields) {
    const status = fields.status as { emoji?: unknown; text?: unknown } | null;
    if (status === null) {
      patch.status = undefined;
    } else if (typeof status === "object" && status !== null) {
      const emoji = cleanText(status.emoji, MAX_STATUS_EMOJI_LENGTH);
      const text = cleanText(status.text, MAX_STATUS_TEXT_LENGTH);
      patch.status = emoji || text ? { emoji, text } : undefined;
    } else {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    const saved = await writeProfile(getProfileClient(), user.username, patch);
    return NextResponse.json({ about: saved.about, status: saved.status });
  } catch (err) {
    console.error("[api/profile] Save failed:", err);
    return NextResponse.json({ error: "Failed to save your profile." }, { status: 502 });
  }
}
