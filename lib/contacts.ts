/**
 * Shared Phone Book contact shape. Contacts are stored server-side in a
 * Twilio Sync Document (see app/api/contacts/route.ts) rather than in
 * browser localStorage, so the same list shows up on every device Amar
 * unlocks the dialer from, not just the one that added them.
 */
export interface Contact {
  id: string;
  name: string;
  /**
   * The primary number, in E.164. Everything that turns a number back into
   * a name - call rows, the incoming-call screen, push notifications via
   * lib/callerName.ts - matches on this exact string, so it stays required
   * and stays the first number even when there are several.
   */
  number: string;
  /** Extra numbers beyond the primary one: work, home, a second mobile. */
  extraNumbers?: ContactNumber[];
  /** Free text: gate codes, which unit they're in, who referred them. */
  notes?: string;
  company?: string;
}

export interface ContactNumber {
  /** What it is to this person - "Work", "Home", "Mobile". */
  label: string;
  /** E.164, same as Contact.number. */
  number: string;
}

/** Every number a contact can be reached on, primary first. */
export function allNumbers(contact: Contact): ContactNumber[] {
  return [
    { label: "Primary", number: contact.number },
    ...(contact.extraNumbers ?? []).filter((n) => n.number),
  ];
}

/**
 * Whether a contact matches what someone typed into a search box.
 *
 * Numbers are stored in E.164, so a plain substring test never matched a
 * query typed the way people actually write numbers - "206 452",
 * "(206) 452-3433" and "206-452" all found nothing. Stripping everything
 * that isn't a digit from both sides fixes that, while still allowing a
 * name search.
 */
export function contactMatches(contact: Contact, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (contact.name.toLowerCase().includes(q)) return true;
  if (contact.company?.toLowerCase().includes(q)) return true;
  const digits = q.replace(/\D/g, "");
  if (!digits) return false;
  return allNumbers(contact).some((n) => n.number.replace(/\D/g, "").includes(digits));
}

/** The same digits-only rule, for matching a bare number against a query. */
export function numberMatches(number: string, query: string): boolean {
  const digits = query.replace(/\D/g, "");
  if (!digits) return false;
  return number.replace(/\D/g, "").includes(digits);
}

/** Alphabetical by name, so a long Phone Book stays navigable. */
export function byName(a: Contact, b: Contact): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}
