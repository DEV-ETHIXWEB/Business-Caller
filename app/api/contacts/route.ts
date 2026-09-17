import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireUser } from "@/lib/auth";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import type { Contact } from "@/lib/contacts";

// Requires Node's crypto module (via requireUser / the twilio SDK), so
// this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const IP_RATE_LIMIT = 60;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;
const MAX_CONTACTS = 500;

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_USERS",
] as const;

function getClient() {
  return twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });
}

// One Phone Book per person, not one shared list - Prateek and Yash each
// have their own client list, the way separate phone lines would.
function documentNameFor(username: string): string {
  return `contacts_${username}`;
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: number }).status === 404;
}

async function readContacts(client: ReturnType<typeof twilio>, username: string): Promise<Contact[]> {
  try {
    const doc = await client.sync.v1
      .services(process.env.TWILIO_SYNC_SERVICE_SID!)
      .documents(documentNameFor(username))
      .fetch();
    const data = doc.data as { contacts?: Contact[] } | undefined;
    return Array.isArray(data?.contacts) ? data.contacts : [];
  } catch (err) {
    // No document yet just means no contacts have ever been saved.
    if (isNotFound(err)) return [];
    throw err;
  }
}

async function writeContacts(client: ReturnType<typeof twilio>, username: string, contacts: Contact[]): Promise<void> {
  const serviceSid = process.env.TWILIO_SYNC_SERVICE_SID!;
  const documentName = documentNameFor(username);
  try {
    await client.sync.v1.services(serviceSid).documents(documentName).update({ data: { contacts } });
  } catch (err) {
    if (isNotFound(err)) {
      await client.sync.v1
        .services(serviceSid)
        .documents.create({ uniqueName: documentName, data: { contacts } });
      return;
    }
    throw err;
  }
}

function validateContacts(input: unknown): Contact[] | null {
  if (!Array.isArray(input) || input.length > MAX_CONTACTS) return null;

  const result: Contact[] = [];
  for (const entry of input) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).id !== "string" ||
      typeof (entry as Record<string, unknown>).name !== "string" ||
      typeof (entry as Record<string, unknown>).number !== "string"
    ) {
      return null;
    }

    const id = (entry as Record<string, string>).id;
    const name = (entry as Record<string, string>).name.trim();
    const number = normalizePhoneNumber((entry as Record<string, string>).number);
    if (!id || !name || !isValidE164(number)) return null;

    result.push({ id, name, number });
  }
  return result;
}

export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "contacts",
    limit: IP_RATE_LIMIT,
    windowMs: IP_RATE_WINDOW_MS,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user } = auth.data;

  try {
    const contacts = await readContacts(getClient(), user.username);
    return NextResponse.json({ contacts });
  } catch (err) {
    console.error("[api/contacts] Twilio fetch failed:", err);
    return NextResponse.json({ error: "Failed to load contacts." }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "contacts",
    limit: IP_RATE_LIMIT,
    windowMs: IP_RATE_WINDOW_MS,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const contacts = validateContacts(fields.contacts);
  if (!contacts) {
    return NextResponse.json({ error: "Invalid contacts." }, { status: 400 });
  }

  try {
    await writeContacts(getClient(), user.username, contacts);
    return NextResponse.json({ contacts });
  } catch (err) {
    console.error("[api/contacts] Twilio save failed:", err);
    return NextResponse.json({ error: "Failed to save contacts." }, { status: 502 });
  }
}
