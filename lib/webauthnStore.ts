import twilio from "twilio";
import type { StoredCredential } from "@/lib/webauthn";

// Server-only (uses the twilio SDK) - never imported from a client component.

// One credential list per person, the same way contacts are scoped (see
// app/api/contacts/route.ts) - Prateek's registered Face ID doesn't log
// Yash in, and vice versa.
function documentNameFor(username: string): string {
  return `webauthn_${username}`;
}

export function getWebAuthnClient() {
  return twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: number }).status === 404;
}

export async function readCredentials(client: ReturnType<typeof twilio>, username: string): Promise<StoredCredential[]> {
  try {
    const doc = await client.sync.v1
      .services(process.env.TWILIO_SYNC_SERVICE_SID!)
      .documents(documentNameFor(username))
      .fetch();
    const data = doc.data as { credentials?: StoredCredential[] } | undefined;
    return Array.isArray(data?.credentials) ? data.credentials : [];
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

export async function writeCredentials(
  client: ReturnType<typeof twilio>,
  username: string,
  credentials: StoredCredential[],
): Promise<void> {
  const serviceSid = process.env.TWILIO_SYNC_SERVICE_SID!;
  const documentName = documentNameFor(username);
  try {
    await client.sync.v1.services(serviceSid).documents(documentName).update({ data: { credentials } });
  } catch (err) {
    if (isNotFound(err)) {
      await client.sync.v1
        .services(serviceSid)
        .documents.create({ uniqueName: documentName, data: { credentials } });
      return;
    }
    throw err;
  }
}
