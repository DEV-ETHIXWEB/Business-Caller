import { NextResponse } from "next/server";
import twilio from "twilio";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { verifyAccessCode } from "@/lib/auth";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import type { Contact } from "@/lib/contacts";

// Requires Node's crypto module (via verifyAccessCode / the twilio SDK),
// so this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const IP_RATE_LIMIT = 60;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;

// The whole Phone Book lives in a single Sync Document, since it's a small
// list (Sync Documents cap at 16 KiB) and there's only ever one device
// writing at a time in practice.
const DOCUMENT_NAME = "contacts";
const MAX_CONTACTS = 500;

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_ACCESS_CODE",
] as const;

function getClient() {
  return twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: number }).status === 404;
}

async function readContacts(client: ReturnType<typeof twilio>): Promise<Contact[]> {
  try {
    const doc = await client.sync.v1.services(process.env.TWILIO_SYNC_SERVICE_SID!).documents(DOCUMENT_NAME).fetch();
    const data = doc.data as { contacts?: Contact[] } | undefined;
    return Array.isArray(data?.contacts) ? data.contacts : [];
  } catch (err) {
    // No document yet just means no contacts have ever been saved.
    if (isNotFound(err)) return [];
    throw err;
  }
}

async function writeContacts(client: ReturnType<typeof twilio>, contacts: Contact[]): Promise<void> {
  const serviceSid = process.env.TWILIO_SYNC_SERVICE_SID!;
  try {
    await client.sync.v1.services(serviceSid).documents(DOCUMENT_NAME).update({ data: { contacts } });
  } catch (err) {
    if (isNotFound(err)) {
      await client.sync.v1
        .services(serviceSid)
        .documents.create({ uniqueName: DOCUMENT_NAME, data: { contacts } });
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

async function requireAccessCode(req: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/contacts] Missing required environment variable: ${key}`);
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Server misconfiguration. Please contact the administrator." },
          { status: 500 },
        ),
      };
    }
  }

  const ip = getClientIp(req);
  const limit = rateLimit(`contacts:${ip}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS);
  if (!limit.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Too many requests. Please wait a few minutes and try again." },
        {
          status: 429,
          headers: { "Retry-After": Math.ceil(limit.retryAfterMs / 1000).toString() },
        },
      ),
    };
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid request body." }, { status: 400 }) };
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const accessCode = typeof fields.accessCode === "string" ? fields.accessCode : "";
  if (!accessCode || !verifyAccessCode(accessCode, process.env.APP_ACCESS_CODE!)) {
    return { ok: false, response: NextResponse.json({ error: "Invalid access code." }, { status: 401 }) };
  }

  return { ok: true, body: fields };
}

export async function POST(req: Request) {
  const auth = await requireAccessCode(req);
  if (!auth.ok) return auth.response;

  try {
    const contacts = await readContacts(getClient());
    return NextResponse.json({ contacts });
  } catch (err) {
    console.error("[api/contacts] Twilio fetch failed:", err);
    return NextResponse.json({ error: "Failed to load contacts." }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const auth = await requireAccessCode(req);
  if (!auth.ok) return auth.response;

  const contacts = validateContacts(auth.body.contacts);
  if (!contacts) {
    return NextResponse.json({ error: "Invalid contacts." }, { status: 400 });
  }

  try {
    await writeContacts(getClient(), contacts);
    return NextResponse.json({ contacts });
  } catch (err) {
    console.error("[api/contacts] Twilio save failed:", err);
    return NextResponse.json({ error: "Failed to save contacts." }, { status: 502 });
  }
}
