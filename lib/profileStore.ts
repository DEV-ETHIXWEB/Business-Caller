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

export interface Profile {
  avatarUrl?: string;
}

export async function readProfile(client: ReturnType<typeof twilio>, username: string): Promise<Profile> {
  try {
    const doc = await client.sync.v1
      .services(process.env.TWILIO_SYNC_SERVICE_SID!)
      .documents(documentNameFor(username))
      .fetch();
    const data = doc.data as Profile | undefined;
    return { avatarUrl: typeof data?.avatarUrl === "string" ? data.avatarUrl : undefined };
  } catch (err) {
    if (isNotFound(err)) return {};
    throw err;
  }
}

export async function writeProfile(client: ReturnType<typeof twilio>, username: string, profile: Profile): Promise<void> {
  const serviceSid = process.env.TWILIO_SYNC_SERVICE_SID!;
  const documentName = documentNameFor(username);
  try {
    await client.sync.v1.services(serviceSid).documents(documentName).update({ data: profile });
  } catch (err) {
    if (isNotFound(err)) {
      await client.sync.v1.services(serviceSid).documents.create({ uniqueName: documentName, data: profile });
      return;
    }
    throw err;
  }
}
