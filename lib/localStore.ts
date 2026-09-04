/**
 * Contacts and the sent-message log live only in this browser's
 * localStorage - there is no backend for them. That means they're private
 * to this one machine/browser and not shared with anyone else who opens
 * the dialer elsewhere. Good enough for a single-laptop tool; if this ever
 * needs to sync across devices, it would move to a real per-user store.
 */

export interface Contact {
  id: string;
  name: string;
  number: string;
}

export interface SentMessage {
  id: string;
  to: string;
  body: string;
  status: string;
  sentAt: number;
}

const CONTACTS_KEY = "dialer_contacts";
const MESSAGE_LOG_KEY = "dialer_message_log";
const MAX_LOGGED_MESSAGES = 30;

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
    // Storage can be unavailable (private browsing, quota) - contacts and
    // history are a convenience, not something the dialer depends on.
  }
}

export function loadContacts(): Contact[] {
  return readJson<Contact[]>(CONTACTS_KEY, []);
}

export function saveContacts(contacts: Contact[]): void {
  writeJson(CONTACTS_KEY, contacts);
}

export function loadMessageLog(): SentMessage[] {
  return readJson<SentMessage[]>(MESSAGE_LOG_KEY, []);
}

export function appendMessageLog(entry: SentMessage): SentMessage[] {
  const next = [entry, ...loadMessageLog()].slice(0, MAX_LOGGED_MESSAGES);
  writeJson(MESSAGE_LOG_KEY, next);
  return next;
}
