import twilio from "twilio";

// Server-only. The per-person rules the incoming webhooks have to know
// about before they decide whether to ring anybody: who is blocked, and
// whether Do Not Disturb is on.
//
// Both of these used to be impossible to honour. `blocked` lived in
// lib/chatPrefs.ts, in localStorage, in one browser - so it hid a chat on
// that one device while the call still rang and the text still arrived.
// Do Not Disturb did not exist at all beyond a cosmetic profile status.
// Neither could ever work from there: a webhook runs on the server, with
// no access to anyone's browser storage.
//
// So they live in Twilio Sync, next to the Phone Book and the push
// subscriptions - shared by every instance, every region and every device
// that person signs in from.

export interface CallRules {
  /** E.164 numbers that may not call or text this person. */
  blocked: string[];
  /** When on, incoming calls are turned away instead of ringing. */
  dnd: boolean;
  /** Optional window during which calls are allowed through. */
  hours?: QuietHours;
}

export interface QuietHours {
  /** Minutes past midnight, local to `timeZone`. */
  startMinute: number;
  endMinute: number;
  /** IANA zone, e.g. "America/Los_Angeles". */
  timeZone: string;
}

export const EMPTY_RULES: CallRules = { blocked: [], dnd: false };

// A person blocks a handful of nuisance numbers, not thousands. The cap
// keeps the Sync document well inside its 16KB limit.
const MAX_BLOCKED = 200;

function documentNameFor(username: string): string {
  return `callrules_${username.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)}`;
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: number }).status === 404;
}

function rulesClient() {
  return twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });
}

function parse(data: unknown): CallRules {
  const raw = (data ?? {}) as Record<string, unknown>;
  const blocked = Array.isArray(raw.blocked)
    ? raw.blocked.filter((n): n is string => typeof n === "string").slice(0, MAX_BLOCKED)
    : [];
  const rules: CallRules = { blocked, dnd: raw.dnd === true };

  const hours = raw.hours as Record<string, unknown> | undefined;
  if (
    hours &&
    typeof hours.startMinute === "number" &&
    typeof hours.endMinute === "number" &&
    typeof hours.timeZone === "string"
  ) {
    rules.hours = {
      startMinute: hours.startMinute,
      endMinute: hours.endMinute,
      timeZone: hours.timeZone,
    };
  }
  return rules;
}

export async function readCallRules(username: string): Promise<CallRules> {
  const serviceSid = process.env.TWILIO_SYNC_SERVICE_SID;
  if (!serviceSid) return EMPTY_RULES;
  try {
    const doc = await rulesClient().sync.v1.services(serviceSid).documents(documentNameFor(username)).fetch();
    return parse(doc.data);
  } catch (err) {
    if (isNotFound(err)) return EMPTY_RULES;
    // Fail open. If Sync is unreachable, a call ringing when it should have
    // been blocked is a far smaller problem than every call being turned
    // away because a lookup failed.
    console.warn("[callRules] Could not read the rules:", err);
    return EMPTY_RULES;
  }
}

export async function writeCallRules(username: string, rules: CallRules): Promise<void> {
  const serviceSid = process.env.TWILIO_SYNC_SERVICE_SID;
  if (!serviceSid) return;
  const client = rulesClient();
  const name = documentNameFor(username);
  const data = {
    blocked: rules.blocked.slice(0, MAX_BLOCKED),
    dnd: rules.dnd,
    ...(rules.hours ? { hours: rules.hours } : {}),
  };
  try {
    await client.sync.v1.services(serviceSid).documents(name).update({ data });
  } catch (err) {
    if (!isNotFound(err)) {
      console.warn("[callRules] Could not save the rules:", err);
      return;
    }
    try {
      await client.sync.v1.services(serviceSid).documents.create({ uniqueName: name, data });
    } catch (createErr) {
      console.warn("[callRules] Could not create the rules document:", createErr);
    }
  }
}

export function isBlocked(rules: CallRules, number: string): boolean {
  return !!number && rules.blocked.includes(number);
}

/**
 * Whether calls should be turned away right now.
 *
 * With no `hours`, the switch is simply on or off. With `hours`, it means
 * "only let calls through inside this window" - so a window that wraps past
 * midnight (22:00 to 07:00) is handled by treating start > end as spanning
 * the day boundary, instead of silently never matching.
 *
 * `now` is injectable so this is testable without waiting for a given hour.
 */
export function shouldSilence(rules: CallRules, now: Date = new Date()): boolean {
  if (!rules.dnd) return false;
  if (!rules.hours) return true;

  const { startMinute, endMinute, timeZone } = rules.hours;
  let minutes: number;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    minutes = hh * 60 + mm;
  } catch {
    // A bad time zone must not make the switch unpredictable: fall back to
    // treating it as plain always-on, which is what was asked for.
    return true;
  }

  const inWindow =
    startMinute <= endMinute
      ? minutes >= startMinute && minutes < endMinute
      : minutes >= startMinute || minutes < endMinute;

  // The window is when calls are ALLOWED, so silence outside it.
  return !inWindow;
}
