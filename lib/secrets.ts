import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

// Server-only. Every secret this app signs with is derived here, so no two
// purposes ever share a key.
//
// The media links used to be signed with TWILIO_API_KEY_SECRET directly.
// Reusing one key across unrelated purposes means a weakness in any one of
// them (a signing oracle, a leaked signature pair, a future feature that
// signs attacker-chosen text) reaches all of them. HKDF splits one base
// secret into independent per-purpose keys instead: knowing the key for
// media links tells you nothing about the key for session tokens, and
// neither tells you anything about the base secret.
//
// SESSION_SECRET is the preferred base. It is optional only so that an
// existing deployment keeps working after this change rather than locking
// everyone out on deploy; TWILIO_API_KEY_SECRET is the fallback, and
// because the derivation is domain-separated, that fallback is still safe.
// Set SESSION_SECRET (32+ random bytes) so that rotating Twilio API keys
// doesn't sign everyone out.

export type SecretPurpose = "media-link" | "session-token";

function baseSecret(): string {
  return process.env.SESSION_SECRET || process.env.TWILIO_API_KEY_SECRET || "";
}

/** True when anything that needs a signing key can actually sign. */
export function signingAvailable(): boolean {
  return baseSecret().length > 0;
}

// Derived once per purpose per warm instance - HKDF is cheap, but this runs
// on every signed request and there is no reason to repeat it.
const derived = new Map<SecretPurpose, Buffer>();

function keyFor(purpose: SecretPurpose): Buffer {
  const cached = derived.get(purpose);
  if (cached) return cached;
  const base = baseSecret();
  if (!base) return Buffer.alloc(0);
  // A fixed salt is fine here: the purpose string is what separates the
  // keys, and the base secret is already high-entropy.
  const key = Buffer.from(hkdfSync("sha256", base, "business-caller.v1", purpose, 32));
  derived.set(purpose, key);
  return key;
}

export function sign(purpose: SecretPurpose, message: string): string {
  const key = keyFor(purpose);
  if (!key.length) return "";
  return createHmac("sha256", key).update(message).digest("hex");
}

/** Constant-time signature check, so a wrong guess reveals nothing about how close it was. */
export function verify(purpose: SecretPurpose, message: string, given: string): boolean {
  const expected = sign(purpose, message);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
