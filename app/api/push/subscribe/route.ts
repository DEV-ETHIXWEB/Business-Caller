import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { pushAvailable } from "@/lib/push";
import { addSubscription, readSubscriptions, removeSubscription } from "@/lib/pushStore";

// Requires Node's crypto module (via requireUser / the twilio SDK), so
// this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const REQUIRED_ENV_VARS = ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_SYNC_SERVICE_SID", "APP_USERS"] as const;

const MAX_ENDPOINT_LENGTH = 1024;
const MAX_KEY_LENGTH = 256;

function cleanLabel(value: unknown): string {
  if (typeof value !== "string") return "This device";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "This device";
}

// Registers this browser to receive call and message notifications.
export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "push-subscribe",
    limit: 30,
    windowMs: 5 * 60 * 1000,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  if (!pushAvailable()) {
    return NextResponse.json(
      { error: "Notifications are not configured on the server yet (VAPID keys are missing)." },
      { status: 503 },
    );
  }

  const sub = (fields.subscription ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof sub.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const authKey = typeof sub.keys?.auth === "string" ? sub.keys.auth : "";

  // The endpoint is a URL this server will later send requests to, so it is
  // checked rather than trusted: https only, and bounded, so a crafted
  // subscription can't point the server at something internal.
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }
  if (
    parsed.protocol !== "https:" ||
    endpoint.length > MAX_ENDPOINT_LENGTH ||
    !p256dh ||
    !authKey ||
    p256dh.length > MAX_KEY_LENGTH ||
    authKey.length > MAX_KEY_LENGTH
  ) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }

  await addSubscription(user.username, {
    endpoint,
    keys: { p256dh, auth: authKey },
    label: cleanLabel(fields.label),
    addedAt: Date.now(),
  });

  const all = await readSubscriptions(user.username);
  return NextResponse.json({ subscribed: true, devices: all.map((s) => ({ label: s.label, addedAt: s.addedAt })) });
}

// Turns notifications off for this browser.
export async function DELETE(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "push-unsubscribe",
    limit: 30,
    windowMs: 5 * 60 * 1000,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const endpoint = typeof fields.endpoint === "string" ? fields.endpoint : "";
  if (!endpoint) return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });

  await removeSubscription(user.username, endpoint);
  return NextResponse.json({ subscribed: false });
}
