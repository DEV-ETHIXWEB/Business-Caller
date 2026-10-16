import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { before, describe, it } from "node:test";
import webpush from "web-push";

// Checks the real web-push machinery - VAPID signing, payload encryption,
// and the urgency/TTL choices lib/push.ts makes - so a change that quietly
// stops notifications being sendable fails here, rather than the first
// time somebody's phone doesn't ring.
//
// `generateRequestDetails` builds exactly the request `sendNotification`
// would put on the wire, without sending it, so this needs no network and
// no stand-in server.
//
// What is NOT covered here: a browser actually subscribing, and the push
// service actually delivering. Both need a live connection to Google's or
// Apple's infrastructure, which no test environment has - those were
// checked by hand against the running app instead.

const CALL_OPTIONS = { urgency: "high", TTL: 45 } as const;
const MESSAGE_OPTIONS = { urgency: "normal", TTL: 6 * 60 * 60 } as const;

before(() => {
  const keys = webpush.generateVAPIDKeys();
  webpush.setVapidDetails("mailto:test@example.com", keys.publicKey, keys.privateKey);
});

// A browser's subscription is a P-256 public key plus 16 random bytes of
// auth secret. Generating a genuine pair means web-push does the real
// encryption rather than a shortcut.
function fakeSubscription() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/fake-device-endpoint",
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

describe("push notifications", () => {
  const payload = JSON.stringify({
    kind: "call",
    title: "+12539059111 is calling",
    body: "on your line +12064523433",
    number: "+12539059111",
  });

  it("signs with VAPID and encrypts the payload", () => {
    const req = webpush.generateRequestDetails(fakeSubscription(), payload, CALL_OPTIONS);

    assert.ok(req.headers.Authorization?.startsWith("vapid "), "carries a VAPID authorization header");
    assert.equal(req.headers["Content-Encoding"], "aes128gcm", "payload is encrypted");
    assert.ok(Buffer.isBuffer(req.body), "body is binary ciphertext");
  });

  it("never puts the caller's number on the wire in the clear", () => {
    // The push service is a third party. It routes the notification; it
    // has no business being able to read who is calling whom.
    const req = webpush.generateRequestDetails(fakeSubscription(), payload, CALL_OPTIONS);
    const body = (req.body as Buffer).toString("latin1");
    assert.equal(body.includes("+12539059111"), false);
    assert.equal(body.includes("is calling"), false);
  });

  it("asks for a ringing call to be delivered urgently and expire fast", () => {
    const req = webpush.generateRequestDetails(fakeSubscription(), payload, CALL_OPTIONS);
    // A call notification that shows up a minute late is worse than none.
    assert.equal(req.headers.Urgency, "high");
    assert.equal(req.headers.TTL, 45);
  });

  it("lets a text wait, and keeps it for hours", () => {
    const req = webpush.generateRequestDetails(fakeSubscription(), JSON.stringify({ kind: "message" }), MESSAGE_OPTIONS);
    assert.equal(req.headers.Urgency, "normal");
    assert.equal(req.headers.TTL, 6 * 60 * 60);
  });

  it("refuses a subscription missing its keys, rather than sending unencrypted", () => {
    assert.throws(() =>
      webpush.generateRequestDetails(
        { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "", auth: "" } },
        payload,
      ),
    );
  });
});
