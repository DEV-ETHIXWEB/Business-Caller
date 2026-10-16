/* Business Caller service worker.
 *
 * Its only job is notifications. It deliberately does not cache anything:
 * a dialer that served a stale shell would be worse than one that simply
 * needs the network, and the app already handles being offline.
 *
 * This runs even when every tab is closed, which is the whole point - it
 * is what lets an incoming call show who is calling before it is answered,
 * instead of the person having to ask.
 */

// Take over immediately on install rather than waiting for every tab to
// close, so a newly deployed worker starts handling notifications at once.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A push with no readable payload still deserves to show something,
    // rather than being dropped silently.
  }

  const isCall = data.kind === "call";
  const title = data.title || (isCall ? "Incoming call" : "New message");
  const body = data.body || "";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // A call replaces the previous call notification rather than stacking;
      // texts are tagged per conversation for the same reason.
      tag: isCall ? "incoming-call" : `chat-${data.number || "unknown"}`,
      renotify: true,
      // A ringing call should interrupt. A text should not take over the
      // screen while someone is mid-sentence on a call.
      requireInteraction: isCall,
      vibrate: isCall ? [400, 200, 400, 200, 400] : [120],
      silent: false,
      timestamp: Date.now(),
      data: { number: data.number || "", kind: data.kind || "message" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const number = (event.notification.data && event.notification.data.number) || "";
  // The app reads this on load and opens straight into that conversation
  // (or the dialer, for a call), so tapping the notification lands where
  // the person expected rather than on the Calls tab.
  const target = number ? `/?from=${encodeURIComponent(number)}` : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse a tab that is already open rather than piling up new ones;
      // an open dialer may already be showing the call.
      for (const client of clients) {
        if ("focus" in client) {
          client.postMessage({ type: "notification-click", number, kind: event.notification.data?.kind });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
