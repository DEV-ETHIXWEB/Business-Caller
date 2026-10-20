import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireUser } from "@/lib/auth";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import type { Contact, ContactNumber } from "@/lib/contacts";

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

// Caps, so one contact can't grow until the 16KB Sync document bursts.
const MAX_NUMBERS_PER_CONTACT = 5;
const MAX_LABEL_LENGTH = 20;
const MAX_NOTES_LENGTH = 500;
const MAX_COMPANY_LENGTH = 80;

// Strips control characters and collapses whitespace, the same way
// lib/profileStore.ts cleanText does for the profile fields.
function cleanField(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
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

    const raw = entry as Record<string, unknown>;
    const id = raw.id as string;
    const name = (raw.name as string).trim();
    const number = normalizePhoneNumber(raw.number as string);
    if (!id || !name || !isValidE164(number)) return null;

    // The optional fields are rebuilt field by field rather than spread, so
    // nothing unexpected can be written into the Sync document - but they
    // must be rebuilt, not dropped. This used to return a bare
    // {id, name, number}, which silently threw away notes and extra numbers
    // on every save: the UI showed them until the next reload, then they
    // were gone.
    const contact: Contact = { id, name, number };

    const extras = raw.extraNumbers;
    if (Array.isArray(extras)) {
      const cleaned: ContactNumber[] = [];
      for (const item of extras.slice(0, MAX_NUMBERS_PER_CONTACT)) {
        if (typeof item !== "object" || item === null) continue;
        const e = item as Record<string, unknown>;
        if (typeof e.number !== "string") continue;
        const extraNumber = normalizePhoneNumber(e.number);
        if (!isValidE164(extraNumber)) continue;
        cleaned.push({
          label: cleanField(e.label, MAX_LABEL_LENGTH) || "Other",
          number: extraNumber,
        });
      }
      if (cleaned.length) contact.extraNumbers = cleaned;
    }

    const notes = cleanField(raw.notes, MAX_NOTES_LENGTH);
    if (notes) contact.notes = notes;
    const company = cleanField(raw.company, MAX_COMPANY_LENGTH);
    if (company) contact.company = company;

    result.push(contact);
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
