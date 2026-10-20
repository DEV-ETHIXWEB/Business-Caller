import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import { readCallRules, writeCallRules, type CallRules, type QuietHours } from "@/lib/callRules";

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

const IP_RATE_LIMIT = 60;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;
const MAX_BLOCKED = 200;

// Reads this person's blocked list and Do Not Disturb setting.
export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "call-rules",
    limit: IP_RATE_LIMIT,
    windowMs: IP_RATE_WINDOW_MS,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;

  return NextResponse.json({ rules: await readCallRules(auth.data.user.username) });
}

function validHours(input: unknown): QuietHours | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const raw = input as Record<string, unknown>;
  const startMinute = Number(raw.startMinute);
  const endMinute = Number(raw.endMinute);
  const timeZone = typeof raw.timeZone === "string" ? raw.timeZone : "";
  const inRange = (n: number) => Number.isInteger(n) && n >= 0 && n < 24 * 60;
  if (!inRange(startMinute) || !inRange(endMinute) || !timeZone) return undefined;
  // A zone the server can't resolve would make shouldSilence fall back to
  // always-on, which is confusing. Reject it here instead.
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
  } catch {
    return undefined;
  }
  return { startMinute, endMinute, timeZone };
}

// Replaces the whole set of rules. The client always sends the full state,
// the same way the Phone Book does, so there is nothing to merge.
export async function PUT(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "call-rules-write",
    limit: IP_RATE_LIMIT,
    windowMs: IP_RATE_WINDOW_MS,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const rawBlocked = Array.isArray(fields.blocked) ? fields.blocked : [];
  if (rawBlocked.length > MAX_BLOCKED) {
    return NextResponse.json({ error: "Too many blocked numbers." }, { status: 400 });
  }

  // Normalised on the way in, because the webhooks compare against Twilio's
  // E.164 `From` exactly - a number stored in any other shape would silently
  // never match, and the block would look like it had been ignored.
  const blocked: string[] = [];
  for (const entry of rawBlocked) {
    if (typeof entry !== "string") continue;
    const number = normalizePhoneNumber(entry);
    if (isValidE164(number) && !blocked.includes(number)) blocked.push(number);
  }

  const rules: CallRules = { blocked, dnd: fields.dnd === true };
  const hours = validHours(fields.hours);
  if (hours) rules.hours = hours;

  await writeCallRules(user.username, rules);
  return NextResponse.json({ rules });
}
