import twilio from "twilio";

// Server-only. Counts failed sign-ins somewhere every serverless instance
// can see, and locks an account once there have been too many.
//
// WHY THIS EXISTS: lib/rateLimit.ts keeps its counters in a Map inside one
// serverless instance. Vercel spreads concurrent requests across many
// instances, each with its own empty Map, so sending guesses in parallel
// sidesteps it almost entirely - measured on the live site, 30 concurrent
// bad logins were all checked against the password and none was refused,
// while the same 30 sent one after another down a single warm instance
// started getting 429s after 7. That made the per-IP limit worthless as a
// brute-force defence, which is the only thing standing between a guessed
// password and every client's messages.
//
// Sync is already used for contacts, profiles and live-call records, so it
// needs no new service, and it is shared by every instance and region. The
// counter is keyed by username rather than IP: an attacker picks their own
// IPs, but they cannot pick whose account they are trying to get into.
//
// This does not replace the per-IP limiter. That one is free and instant
// and still sheds most junk; this one is the backstop that actually holds.

const MAX_FAILURES = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
// Failures stop counting once they are this old, so an occasional typo
// weeks apart never accumulates into a lockout.
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
// Sync drops the document on its own, so nothing has to be swept up.
const RECORD_TTL_SECONDS = 24 * 60 * 60;

function documentNameFor(username: string): string {
  // Usernames come from APP_USERS, but this is interpolated into a Sync
  // resource name, so anything unexpected is flattened rather than trusted.
  const safe = username.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return `loginguard_${safe}`;
}

interface GuardRecord {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

export interface LockoutState {
  locked: boolean;
  retryAfterMs: number;
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: number }).status === 404;
}

function guardClient() {
  return twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });
}

function parse(data: unknown): GuardRecord {
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    failures: typeof raw.failures === "number" ? raw.failures : 0,
    firstFailureAt: typeof raw.firstFailureAt === "number" ? raw.firstFailureAt : 0,
    lockedUntil: typeof raw.lockedUntil === "number" ? raw.lockedUntil : 0,
  };
}

async function read(username: string): Promise<GuardRecord | null> {
  const serviceSid = process.env.TWILIO_SYNC_SERVICE_SID;
  if (!serviceSid) return null;
  try {
    const doc = await guardClient().sync.v1.services(serviceSid).documents(documentNameFor(username)).fetch();
    return parse(doc.data);
  } catch (err) {
    if (isNotFound(err)) return { failures: 0, firstFailureAt: 0, lockedUntil: 0 };
    // Sync being unreachable must not take sign-in down with it. The
    // per-IP limiter and the password itself still apply.
    console.warn("[loginGuard] Could not read the lockout record:", err);
    return null;
  }
}

async function write(username: string, record: GuardRecord): Promise<void> {
  const serviceSid = process.env.TWILIO_SYNC_SERVICE_SID;
  if (!serviceSid) return;
  const client = guardClient();
  const name = documentNameFor(username);
  try {
    await client.sync.v1.services(serviceSid).documents(name).update({ data: record as unknown as object });
  } catch (err) {
    if (!isNotFound(err)) {
      console.warn("[loginGuard] Could not record the failed sign-in:", err);
      return;
    }
    try {
      await client.sync.v1
        .services(serviceSid)
        .documents.create({ uniqueName: name, data: record as unknown as object, ttl: RECORD_TTL_SECONDS });
    } catch (createErr) {
      console.warn("[loginGuard] Could not create the lockout record:", createErr);
    }
  }
}

/** Whether this account is currently locked out. Checked before the password is. */
export async function checkLockout(username: string, now = Date.now()): Promise<LockoutState> {
  const record = await read(username);
  if (!record) return { locked: false, retryAfterMs: 0 };
  if (record.lockedUntil > now) return { locked: true, retryAfterMs: record.lockedUntil - now };
  return { locked: false, retryAfterMs: 0 };
}

/** Called after a wrong password. Locks the account once failures pile up. */
export async function recordFailure(username: string, now = Date.now()): Promise<void> {
  const record = (await read(username)) ?? { failures: 0, firstFailureAt: 0, lockedUntil: 0 };
  // A fresh window: either the first failure, or the previous run of them
  // is old enough to have aged out.
  const stale = !record.firstFailureAt || now - record.firstFailureAt > FAILURE_WINDOW_MS;
  const failures = stale ? 1 : record.failures + 1;
  await write(username, {
    failures,
    firstFailureAt: stale ? now : record.firstFailureAt,
    lockedUntil: failures >= MAX_FAILURES ? now + LOCKOUT_MS : 0,
  });
}

/** Called after a correct password, so one good sign-in clears the slate. */
export async function clearFailures(username: string): Promise<void> {
  const record = await read(username);
  if (!record || (record.failures === 0 && record.lockedUntil === 0)) return;
  await write(username, { failures: 0, firstFailureAt: 0, lockedUntil: 0 });
}

export const LOGIN_MAX_FAILURES = MAX_FAILURES;
export const LOGIN_LOCKOUT_MS = LOCKOUT_MS;
