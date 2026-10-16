import webpush from "web-push";
import { readSubscriptions, removeSubscription, type PushSubscriptionRecord } from "./pushStore";

// Server-only. Sends a notification to every device a person has signed up
// from, so the dialer can tell them about a call or a text while the app is
// closed or in the background.
//
// This is how an incoming call stops being a mystery. Without it, the only
// place a caller's number appears is a screen that has to already be open,
// and the forwarded call reaching the person's own phone shows the Twilio
// number rather than whoever rang.

export type PushKind = "call" | "message";

export interface PushPayload {
  kind: PushKind;
  /** Big line: who it is. A saved contact name, else the number. */
  title: string;
  /** Smaller line: the number (when a name is shown), or a text preview. */
  body: string;
  /** The number involved, so tapping the notification opens that chat. */
  number: string;
}

let configured = false;

function ensureConfigured(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  if (!configured) {
    // The subject identifies this app to the push service; a mailto or the
    // site URL both qualify. It is required by the VAPID spec.
    const subject = process.env.VAPID_SUBJECT || process.env.PUBLIC_BASE_URL || "mailto:admin@example.com";
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }
  return true;
}

export function pushAvailable(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * Best effort by design: a notification that cannot be delivered must never
 * take down the call or the text it was describing. Every failure is logged
 * and swallowed.
 *
 * A 404 or 410 from the push service means that subscription is dead - the
 * browser was uninstalled, site data cleared, permission revoked - so it is
 * dropped rather than retried forever.
 */
export async function sendPush(username: string, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;

  let subscriptions: PushSubscriptionRecord[];
  try {
    subscriptions = await readSubscriptions(username);
  } catch (err) {
    console.warn("[push] Could not read subscriptions:", err);
    return 0;
  }
  if (!subscriptions.length) return 0;

  const body = JSON.stringify(payload);
  let delivered = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          body,
          // A ringing call is worth waking the device for, and is useless a
          // minute later; a text can wait a little and is worth keeping.
          payload.kind === "call"
            ? { urgency: "high", TTL: 45 }
            : { urgency: "normal", TTL: 6 * 60 * 60 },
        );
        delivered += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await removeSubscription(username, sub.endpoint).catch(() => {});
          return;
        }
        console.warn("[push] Delivery failed:", status, err instanceof Error ? err.message : err);
      }
    }),
  );

  return delivered;
}
