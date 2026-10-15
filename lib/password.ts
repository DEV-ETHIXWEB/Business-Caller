import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Server-only. Password hashing for APP_USERS entries.
//
// scrypt is deliberately slow and memory-hard, so guessing against a
// stolen hash costs real time and real RAM per attempt, unlike a plain
// SHA-256 which a GPU runs billions of times a second. Node ships it, so
// this needs no dependency.
//
// Format: scrypt:<salt hex>:<key hex>. The parameters are fixed rather
// than stored, because changing them means re-hashing every entry anyway
// and a mismatched length is rejected below.
//
// The separator is a colon, NOT the conventional "$", because these hashes
// live inside APP_USERS - an environment variable. Environment loaders
// expand "$NAME" references inside values, and a hex-digit run after a "$"
// looks exactly like a variable name: a "scrypt$abc...$def..." hash came
// back as the bare string "scrypt", every password then failed to verify,
// and everyone was locked out with no error anywhere to say why. A colon
// has no such meaning to any shell or dotenv parser.

const SALT_BYTES = 16;
const KEY_BYTES = 64;
// N=16384 keeps a single verification around 50-100ms on Vercel's
// hardware: unnoticeable at sign-in (once per session now that sessions
// are tokens), punishing in bulk.
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

const PREFIX = "scrypt";
const SEP = ":";

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(password, salt, KEY_BYTES, SCRYPT_OPTIONS);
  return [PREFIX, salt.toString("hex"), key.toString("hex")].join(SEP);
}

export function isPasswordHash(value: string): boolean {
  return value.startsWith(`${PREFIX}${SEP}`);
}

/**
 * Constant-time check of a password against a stored hash. Returns false
 * for anything malformed rather than throwing - a broken APP_USERS entry
 * must fail closed, never crash the sign-in route.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(SEP);
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], "hex");
    expected = Buffer.from(parts[2], "hex");
  } catch {
    return false;
  }
  if (!salt.length || expected.length !== KEY_BYTES) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, KEY_BYTES, SCRYPT_OPTIONS);
  } catch {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

/**
 * Burns roughly the same work as a real verification, for usernames that
 * do not exist. Without it, an unknown username returns immediately while
 * a real one spends ~80ms in scrypt, which tells an attacker which of the
 * two they guessed - exactly the list they need before brute-forcing.
 */
const DUMMY_HASH = hashPassword(randomBytes(32).toString("hex"));

export function burnPasswordWork(password: string): void {
  verifyPassword(password, DUMMY_HASH);
}
