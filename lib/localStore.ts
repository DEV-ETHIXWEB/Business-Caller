/**
 * Contacts live only in this browser's localStorage - there is no backend
 * for them. That means they're private to this one machine/browser and not
 * shared with anyone else who opens the dialer elsewhere. Good enough for a
 * single-laptop tool; if this ever needs to sync across devices, it would
 * move to a real per-user store.
 *
 * Message history is NOT stored here - it's read live from Twilio's own
 * Message resource (see app/api/messages/route.ts), which already records
 * every inbound and outbound SMS on the account. That's the only way a
 * reply shows up automatically instead of just what this browser sent.
 */

export interface Contact {
  id: string;
  name: string;
  number: string;
}

const CONTACTS_KEY = "dialer_contacts";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private browsing, quota) - contacts are a
    // convenience, not something the dialer depends on.
  }
}

export function loadContacts(): Contact[] {
  return readJson<Contact[]>(CONTACTS_KEY, []);
}

export function saveContacts(contacts: Contact[]): void {
  writeJson(CONTACTS_KEY, contacts);
}
