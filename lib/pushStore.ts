import twilio from "twilio";

// Server-only. Where each person's push subscriptions live.
//
// A "subscription" is what a browser hands back when someone allows
// notifications: an endpoint URL at that browser vendor's push service plus
// two keys used to encrypt the payload. One per browser/device, so a person
// who uses the dialer on their phone and their laptop has two, and a
// notification goes to both.
//
// Stored in Twilio Sync, scoped per username exactly like the Phone Book
// and the Face ID credentials - nothing new to provision, and Prateek's
// phone never gets Yash's notifications.

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** What the person will recognise in Settings, e.g. "iPhone - Safari". */
  label: string;
  addedAt: number;
}

// A person realistically has a phone, a laptop, maybe a tablet. The cap
// stops a browser that re-subscribes on every visit (which happens when
// site data is cleared) from growing the document without limit - Sync
// documents are capped at 16KB.
const MAX_SUBSCRIPTIONS = 10;

function documentNameFor(username: string): string {
  return `push_${username.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)}`;
}

export function getPushClient() {
  return twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: number }).status === 404;
}

function parse(data: unknown): PushSubscriptionRecord[] {
  const raw = (data ?? {}) as { subscriptions?: unknown };
  if (!Array.isArray(raw.subscriptions)) return [];
  return raw.subscriptions.filter((s): s is PushSubscriptionRecord => {
    const r = s as PushSubscriptionRecord;
    return !!r && typeof r.endpoint === "string" && !!r.keys && typeof r.keys.p256dh === "string" && typeof r.keys.auth === "string";
  });
}

export async function readSubscriptions(username: string): Promise<PushSubscriptionRecord[]> {
  const serviceSid = process.env.TWILIO_SYNC_SERVICE_SID;
  if (!serviceSid) return [];
  try {
    const doc = await getPushClient().sync.v1.services(serviceSid).documents(documentNameFor(username)).fetch();
    return parse(doc.data);
  } catch (err) {
    if (isNotFound(err)) return [];
    console.warn("[pushStore] Could not read subscriptions:", err);
    return [];
  }
}

export async function writeSubscriptions(username: string, subscriptions: PushSubscriptionRecord[]): Promise<void> {
  const serviceSid = process.env.TWILIO_SYNC_SERVICE_SID;
  if (!serviceSid) return;
  const client = getPushClient();
  const name = documentNameFor(username);
  const data = { subscriptions: subscriptions.slice(-MAX_SUBSCRIPTIONS) };
  try {
    await client.sync.v1.services(serviceSid).documents(name).update({ data });
  } catch (err) {
    if (!isNotFound(err)) {
      console.warn("[pushStore] Could not save subscriptions:", err);
      return;
    }
    try {
      await client.sync.v1.services(serviceSid).documents.create({ uniqueName: name, data });
    } catch (createErr) {
      console.warn("[pushStore] Could not create the subscriptions document:", createErr);
    }
  }
}

/** Adds a subscription, replacing any earlier one with the same endpoint. */
export async function addSubscription(username: string, record: PushSubscriptionRecord): Promise<void> {
  const current = await readSubscriptions(username);
  const next = current.filter((s) => s.endpoint !== record.endpoint);
  next.push(record);
  await writeSubscriptions(username, next);
}

export async function removeSubscription(username: string, endpoint: string): Promise<void> {
  const current = await readSubscriptions(username);
  const next = current.filter((s) => s.endpoint !== endpoint);
  if (next.length !== current.length) await writeSubscriptions(username, next);
}
