import twilio from "twilio";

// Server-only (uses the twilio SDK) - never imported from a client component.

// One tiny profile doc per person, the same scoping pattern as contacts and
// webauthn credentials - just an avatar URL, well under Sync's 16KB
// document limit since the actual image bytes live in Vercel Blob, not here.
function documentNameFor(username: string): string {
  return `profile_${username}`;
}

export function getProfileClient() {
  return twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: number }).status === 404;
}

export interface ProfileStatus {
  emoji: string;
  text: string;
}

export interface Profile {
  avatarUrl?: string;
  /** Short "About" line, like WhatsApp's. */
  about?: string;
  /** Current mood/availability, shown next to the profile picture. */
  status?: ProfileStatus;
}

export const MAX_ABOUT_LENGTH = 100;
export const MAX_STATUS_TEXT_LENGTH = 40;
export const MAX_STATUS_EMOJI_LENGTH = 8;

// Strips control characters and collapses whitespace, so a stored line can
// never carry anything odd into another screen.
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function parseProfile(data: unknown): Profile {
  const raw = (data ?? {}) as Record<string, unknown>;
  const profile: Profile = {};
  if (typeof raw.avatarUrl === "string") profile.avatarUrl = raw.avatarUrl;
  const about = cleanText(raw.about, MAX_ABOUT_LENGTH);
  if (about) profile.about = about;
  const status = raw.status as Record<string, unknown> | undefined;
  if (status && typeof status === "object") {
    const emoji = cleanText(status.emoji, MAX_STATUS_EMOJI_LENGTH);
    const text = cleanText(status.text, MAX_STATUS_TEXT_LENGTH);
    if (emoji || text) profile.status = { emoji, text };
  }
  return profile;
}

export async function readProfile(client: ReturnType<typeof twilio>, username: string): Promise<Profile> {
  try {
    const doc = await client.sync.v1
      .services(process.env.TWILIO_SYNC_SERVICE_SID!)
      .documents(documentNameFor(username))
      .fetch();
    return parseProfile(doc.data);
  } catch (err) {
    if (isNotFound(err)) return {};
    throw err;
  }
}

// Merges the patch into what is already stored (a key set to undefined is
// removed), so changing the photo never wipes the status and vice versa.
export async function writeProfile(
  client: ReturnType<typeof twilio>,
  username: string,
  patch: Partial<Profile>,
): Promise<Profile> {
  const serviceSid = process.env.TWILIO_SYNC_SERVICE_SID!;
  const documentName = documentNameFor(username);
  const existing = await readProfile(client, username);
  const merged: Profile = { ...existing, ...patch };
  for (const key of Object.keys(merged) as (keyof Profile)[]) {
    if (merged[key] === undefined) delete merged[key];
  }
  try {
    await client.sync.v1.services(serviceSid).documents(documentName).update({ data: merged });
  } catch (err) {
    if (isNotFound(err)) {
      await client.sync.v1.services(serviceSid).documents.create({ uniqueName: documentName, data: merged });
      return merged;
    }
    throw err;
  }
  return merged;
}
