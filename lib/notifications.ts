"use client";

// Browser-side notification setup: register the service worker, ask once,
// and hand the resulting subscription to the server.
//
// WHAT THIS CAN AND CANNOT DO, because it matters for what to expect:
//
// On Android and desktop, notifications work in an ordinary browser tab
// and keep working with the app closed.
//
// On iPhone and iPad they only work when the app has been added to the
// Home Screen and opened from there (iOS 16.4+). Apple does not deliver
// web push to a page in a Safari tab, at all - so "Add to Home Screen" is
// not a nicety here, it is the whole feature.
//
// And a web notification is not a native phone ring. A real full-screen
// incoming-call screen with a ringtone - what Skype and WhatsApp do - needs
// a native app using CallKit, which a web app cannot reach. What this does
// is make the device buzz and show who is calling, which answers the
// question the person actually has.

export type PushState =
  | "unsupported" // Browser has no push, or iOS Safari outside the Home Screen app
  | "needs-install" // iOS, and the app hasn't been added to the Home Screen yet
  | "denied" // The person said no (browser setting, has to be undone there)
  | "off" // Supported and allowed to ask, not subscribed
  | "on"; // Subscribed; notifications will arrive

const SW_URL = "/sw.js";

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** True when running as an installed/Home Screen app rather than a tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own, non-standard flag - the only one iOS sets.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) {
    // Spell out the iOS case rather than saying "unsupported", because it
    // is fixable by the person in about ten seconds.
    return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = await reg?.pushManager.getSubscription();
    return sub ? "on" : "off";
  } catch {
    return "off";
  }
}

// The VAPID key crosses the wire base64url-encoded; PushManager wants raw
// bytes.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "This device";
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : "Device";
  const browser = /EdgA?\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua) && !/Edg/.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return `${os} · ${browser}`;
}

export class PushError extends Error {}

/**
 * Turns notifications on for this browser. Returns the new state.
 *
 * `sendToServer` is passed in rather than fetched here so this module stays
 * free of the app's auth details.
 */
export async function enablePush(
  vapidPublicKey: string,
  sendToServer: (subscription: PushSubscriptionJSON, label: string) => Promise<void>,
): Promise<PushState> {
  if (!pushSupported()) {
    throw new PushError(
      isIos() && !isStandalone()
        ? "On iPhone, add this app to your Home Screen first, then open it from there and turn this on."
        : "This browser can't show notifications.",
    );
  }
  if (!vapidPublicKey) throw new PushError("Notifications aren't configured on the server yet.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new PushError(
      permission === "denied"
        ? "Notifications are blocked for this site. Allow them in your browser settings and try again."
        : "Notifications weren't allowed.",
    );
  }

  const registration = await navigator.serviceWorker.register(SW_URL);
  // A brand new registration isn't usable until it is active.
  await navigator.serviceWorker.ready;

  // An existing subscription made with a different VAPID key (the server's
  // keys were rotated) can never be delivered to, so it is replaced.
  const existing = await registration.pushManager.getSubscription();
  if (existing) await existing.unsubscribe().catch(() => {});

  const subscription = await registration.pushManager.subscribe({
    // Required by Chrome: every push must result in something the person
    // sees. This app only ever sends visible notifications anyway.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });

  await sendToServer(subscription.toJSON(), deviceLabel());
  return "on";
}

export async function disablePush(removeFromServer: (endpoint: string) => Promise<void>): Promise<PushState> {
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await removeFromServer(sub.endpoint);
      await sub.unsubscribe();
    }
  } catch {
    // Already gone; the state below reports the truth either way.
  }
  return "off";
}
