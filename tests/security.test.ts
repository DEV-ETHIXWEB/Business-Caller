import assert from "node:assert/strict";
import { describe, it } from "node:test";

// A throwaway signing key, set before anything reads it - lib/secrets.ts
// derives its per-purpose keys lazily on first use, so a static import is
// fine here. These tests run the real HMAC and scrypt code, not a stub.
process.env.SESSION_SECRET = "test-secret-not-used-anywhere-real-0123456789";

import { hashPassword, isPasswordHash, verifyPassword } from "@/lib/password";
import { issueSessionToken, readSessionToken } from "@/lib/session";
import { sign, verify } from "@/lib/secrets";
import { signedMediaUrl, verifyMediaSignature } from "@/lib/media";
import { isOurCopy } from "@/lib/messageThread";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";

describe("password hashing", () => {
  it("accepts the right password and rejects a wrong one", () => {
    const stored = hashPassword("correct horse battery staple");
    assert.ok(isPasswordHash(stored));
    assert.equal(verifyPassword("correct horse battery staple", stored), true);
    assert.equal(verifyPassword("Correct horse battery staple", stored), false);
    assert.equal(verifyPassword("", stored), false);
  });

  it("salts, so the same password hashes differently every time", () => {
    assert.notEqual(hashPassword("same"), hashPassword("same"));
  });

  it("uses no '$', which environment loaders would expand away", () => {
    // A "scrypt$<hex>$<hex>" hash inside APP_USERS gets its $-runs read as
    // variable references and collapses to "scrypt", silently locking
    // everyone out. Guard against that format ever coming back.
    assert.equal(hashPassword("x").includes("$"), false);
  });

  it("fails closed on a malformed stored hash instead of throwing", () => {
    for (const bad of ["", "nonsense", "scrypt:zz:zz", "scrypt:aa", "bcrypt:a:b", "scrypt", "scrypt$a$b"]) {
      assert.equal(verifyPassword("x", bad), false);
    }
  });
});

describe("session tokens", () => {
  it("round-trips the username it was issued for", () => {
    const claims = readSessionToken(issueSessionToken("amar"));
    assert.equal(claims?.username, "amar");
  });

  it("rejects a token whose username was edited", () => {
    const token = issueSessionToken("amar");
    const tampered = token.replace("amar", "prateek");
    assert.equal(readSessionToken(tampered), null);
  });

  it("rejects a token whose expiry was pushed out", () => {
    const [user, issued, expires, sig] = issueSessionToken("amar").split(".");
    const longer = [user, issued, String(Number(expires) + 86_400_000), sig].join(".");
    assert.equal(readSessionToken(longer), null);
  });

  it("rejects an expired token", () => {
    const past = Date.now() - 48 * 60 * 60 * 1000;
    assert.equal(readSessionToken(issueSessionToken("amar", past)), null);
  });

  it("rejects junk without throwing", () => {
    for (const bad of ["", "a.b.c.d", "....", "x".repeat(900)]) {
      assert.equal(readSessionToken(bad), null);
    }
  });
});

describe("per-purpose signing keys", () => {
  it("gives different keys to different purposes", () => {
    assert.notEqual(sign("media-link", "same"), sign("session-token", "same"));
  });

  it("does not accept a signature made for another purpose", () => {
    assert.equal(verify("session-token", "same", sign("media-link", "same")), false);
  });
});

describe("media links", () => {
  const M = "SM03478d1662f27644350661c6160f8303";
  const A = "ME03478d1662f27644350661c6160f8303";

  function parts(url: string) {
    const q = new URLSearchParams(url.split("?")[1]);
    return { e: Number(q.get("e")), s: q.get("s") ?? "", u: q.get("u") ?? "" };
  }

  it("verifies a link it just issued", () => {
    const { e, s, u } = parts(signedMediaUrl("amar", M, A));
    assert.equal(verifyMediaSignature(u, M, A, e, s), true);
  });

  it("will not let another user replay the link", () => {
    const { e, s } = parts(signedMediaUrl("amar", M, A));
    assert.equal(verifyMediaSignature("prateek", M, A, e, s), false);
  });

  it("will not let the attachment be swapped", () => {
    const { e, s, u } = parts(signedMediaUrl("amar", M, A));
    assert.equal(verifyMediaSignature(u, M, "ME" + "f".repeat(32), e, s), false);
  });

  it("rejects an expiry pushed into the future", () => {
    const { s, u } = parts(signedMediaUrl("amar", M, A));
    assert.equal(verifyMediaSignature(u, M, A, 4_102_444_800, s), false);
  });
});

describe("whose copy of a message is whose", () => {
  const US = "+12064523433";
  const THEM = "+18722784999";

  it("keeps our outbound and their inbound", () => {
    assert.equal(isOurCopy({ direction: "outbound-api", from: US, to: THEM }, US), true);
    assert.equal(isOurCopy({ direction: "inbound", from: THEM, to: US }, US), true);
  });

  it("drops the colleague's copy of a text we sent", () => {
    // Same from/to as ours; only `direction` tells them apart.
    assert.equal(isOurCopy({ direction: "inbound", from: US, to: THEM }, US), false);
  });

  it("drops the colleague's copy of a text they sent us", () => {
    assert.equal(isOurCopy({ direction: "outbound-api", from: THEM, to: US }, US), false);
  });
});

describe("phone normalisation", () => {
  it("accepts E.164 and rejects the rest", () => {
    assert.equal(isValidE164(normalizePhoneNumber("+1 206 452 3433")), true);
    assert.equal(isValidE164(normalizePhoneNumber("hello")), false);
    assert.equal(isValidE164(normalizePhoneNumber("")), false);
  });
});
