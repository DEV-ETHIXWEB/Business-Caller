import twilio from "twilio";
import type { Contact } from "./contacts";

// Server-only. Turns a bare number into whatever the person would
// recognise, for the notifications that announce a call or a text.
//
// "+12539059111 is calling" is better than nothing, but "Kevin Roy" is the
// thing that actually answers the question the person is asking when the
// phone rings. The Phone Book already holds that mapping, scoped per user,
// so the notification reads the same way the app does.

function documentNameFor(username: string): string {
  return `contacts_${username}`;
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: number }).status === 404;
}

export async function lookupContactName(username: string, number: string): Promise<string | undefined> {
  const serviceSid = process.env.TWILIO_SYNC_SERVICE_SID;
  if (!serviceSid || !number) return undefined;
  try {
    const client = twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
      accountSid: process.env.TWILIO_ACCOUNT_SID!,
    });
    const doc = await client.sync.v1.services(serviceSid).documents(documentNameFor(username)).fetch();
    const data = doc.data as { contacts?: Contact[] } | undefined;
    if (!Array.isArray(data?.contacts)) return undefined;
    return data.contacts.find((c) => c.number === number)?.name;
  } catch (err) {
    // A name is a nicety. Never let looking one up stop the notification -
    // the number alone still answers "who is this?".
    if (!isNotFound(err)) console.warn("[callerName] Could not read contacts:", err);
    return undefined;
  }
}
