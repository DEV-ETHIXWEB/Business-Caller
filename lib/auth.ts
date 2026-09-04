import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison against APP_ACCESS_CODE, shared by every route
 * that gates access behind the access code (currently /api/token and
 * /api/sms) so the check can't drift between them.
 */
export function verifyAccessCode(candidate: string, expected: string): boolean {
  const bufA = Buffer.from(candidate, "utf8");
  const bufB = Buffer.from(expected, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
