/**
 * Shared phone-number helpers, used by both the browser dialer and the
 * server-side TwiML endpoint. Keeping validation here means the same rule
 * is enforced on both sides instead of drifting apart.
 */

// E.164: a leading "+", 1-15 digits total, no leading 0 after the "+".
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Strips everything except a leading "+" and digits, so common copy/paste
 * formats like "+1 (206) 452-3433" or "+1-206-452-3433" still validate.
 */
export function normalizePhoneNumber(input: string): string {
  const trimmed = input.trim();
  const hasLeadingPlus = trimmed.startsWith("+");
  const digitsOnly = trimmed.replace(/[^\d]/g, "");
  return (hasLeadingPlus ? "+" : "") + digitsOnly;
}

export function isValidE164(value: string): boolean {
  return E164_REGEX.test(value);
}
