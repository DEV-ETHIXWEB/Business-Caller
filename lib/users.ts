/**
 * Multi-user config: each entry is one person with their own login and
 * their own Twilio number. Whoever logs in gets a dialer scoped to their
 * own number - their calls show that caller ID, their SMS sends from it,
 * and their Messages/Phone Book only cover that number's conversations.
 *
 * Defined via a single JSON env var (APP_USERS) rather than a database:
 * there's no user-management UI to build, passwords never sit in the
 * Sync store used for everything else, and it's consistent with how
 * every other secret in this app already works. Adding a person means
 * adding an entry and redeploying - fine for a handful of employees.
 *
 * One shared TwiML App and Voice Request URL serves every user: the
 * Voice webhook (app/api/voice/route.ts) picks the caller ID dynamically
 * from whichever identity placed the call, so nothing in Twilio Console
 * needs to be duplicated per person.
 */

export interface AppUser {
  /** Login username, e.g. "prateek". Case-sensitive, must be unique. */
  username: string;
  password: string;
  /** This user's Twilio number, in E.164 - their caller ID and SMS sender. */
  phoneNumber: string;
  /** Voice Grant identity for this user. Twilio reports it back as
   * "client:<identity>" on outbound calls, which is how /api/voice knows
   * which user's number to dial from. */
  identity: string;
  /** Shown in the UI ("Calling from ...") and in device-management lists. */
  label: string;
}

interface RawAppUser {
  username?: unknown;
  password?: unknown;
  phoneNumber?: unknown;
  label?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseUsers(): AppUser[] {
  const raw = process.env.APP_USERS;
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[lib/users] APP_USERS is not valid JSON:", err);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.error("[lib/users] APP_USERS must be a JSON array.");
    return [];
  }

  const users: AppUser[] = [];
  for (const entry of parsed as RawAppUser[]) {
    if (
      !isNonEmptyString(entry.username) ||
      !isNonEmptyString(entry.password) ||
      !isNonEmptyString(entry.phoneNumber) ||
      !isNonEmptyString(entry.label)
    ) {
      console.error("[lib/users] Skipping an APP_USERS entry missing a required field.");
      continue;
    }
    users.push({
      username: entry.username,
      password: entry.password,
      phoneNumber: entry.phoneNumber,
      label: entry.label,
      identity: `dialer-${entry.username}`,
    });
  }
  return users;
}

// Parsed once per warm serverless instance - APP_USERS only changes on
// redeploy, so there's no need to re-parse it on every request.
let cachedUsers: AppUser[] | null = null;

export function getUsers(): AppUser[] {
  if (!cachedUsers) cachedUsers = parseUsers();
  return cachedUsers;
}

export function findUserByUsername(username: string): AppUser | undefined {
  return getUsers().find((u) => u.username === username);
}

export function findUserByIdentity(identity: string): AppUser | undefined {
  return getUsers().find((u) => u.identity === identity);
}
