/**
 * Shared Phone Book contact shape. Contacts are stored server-side in a
 * Twilio Sync Document (see app/api/contacts/route.ts) rather than in
 * browser localStorage, so the same list shows up on every device Amar
 * unlocks the dialer from, not just the one that added them.
 */
export interface Contact {
  id: string;
  name: string;
  number: string;
}
