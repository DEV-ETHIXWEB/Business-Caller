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
  /**
   * Plaintext password. Deprecated and only still read so an existing
   * deployment keeps working across this change - set `passwordHash`
   * instead (see lib/password.ts for how to generate one). A plaintext
   * entry means anyone who can read the environment - a dashboard viewer,
   * a logged env dump, a leaked backup - reads the password itself.
   */
  password?: string;
  /** scrypt hash of the password, as `scrypt$<salt hex>$<key hex>`. Preferred. */
  passwordHash?: string;
  /** This user's Twilio number, in E.164 - their caller ID and SMS sender. */
  phoneNumber: string;
  /** Voice Grant identity for this user. Twilio reports it back as
   * "client:<identity>" on outbound calls, which is how /api/voice knows
   * which user's number to dial from. */
  identity: string;
  /** Shown in the UI ("Calling from ...") and in device-management lists. */
  label: string;
  /**
   * Optional: a personal phone to ring at the same time as the browser when
   * someone calls this user's Twilio number (E.164). This is what takes over
   * the plain call-forwarding that used to be configured straight on the
   * number in Twilio Console - with the difference that the forwarded call
   * now carries the *original caller's* number as its caller ID, so the
   * phone that rings shows who is really calling instead of showing this
   * user's own Twilio number back at them. Leave it out and only the browser
   * dialer rings.
   */
  forwardTo?: string;
}

interface RawAppUser {
  username?: unknown;
  password?: unknown;
  passwordHash?: unknown;
  phoneNumber?: unknown;
  label?: unknown;
  forwardTo?: unknown;
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
    const hasSecret = isNonEmptyString(entry.passwordHash) || isNonEmptyString(entry.password);
    if (
      !isNonEmptyString(entry.username) ||
      !hasSecret ||
      !isNonEmptyString(entry.phoneNumber) ||
      !isNonEmptyString(entry.label)
    ) {
      console.error("[lib/users] Skipping an APP_USERS entry missing a required field.");
      continue;
    }
    if (!isNonEmptyString(entry.passwordHash)) {
      console.warn(
        `[lib/users] "${entry.username}" still uses a plaintext password. Replace "password" with "passwordHash" - see README, Environment variables.`,
      );
    }
    users.push({
      username: entry.username,
      ...(isNonEmptyString(entry.password) ? { password: entry.password } : {}),
      ...(isNonEmptyString(entry.passwordHash) ? { passwordHash: entry.passwordHash.trim() } : {}),
      phoneNumber: entry.phoneNumber,
      label: entry.label,
      identity: `dialer-${entry.username}`,
      ...(isNonEmptyString(entry.forwardTo) ? { forwardTo: entry.forwardTo.trim() } : {}),
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

/** Which user a call or text arriving on one of our numbers belongs to.
 * Used by the incoming-call webhook, where the only thing identifying the
 * person is the Twilio number that was dialled. */
export function findUserByPhoneNumber(phoneNumber: string): AppUser | undefined {
  return getUsers().find((u) => u.phoneNumber === phoneNumber);
}
