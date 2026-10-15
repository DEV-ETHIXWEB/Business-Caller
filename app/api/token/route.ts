import { NextResponse } from "next/server";
import twilio from "twilio";
import { userFromSessionToken, verifyUserCredentials } from "@/lib/auth";
import { checkLockout, clearFailures, recordFailure } from "@/lib/loginGuard";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { issueSessionToken, SESSION_TTL_MS } from "@/lib/session";
import { getProfileClient, readProfile, type Profile } from "@/lib/profileStore";

// Requires Node's crypto module (timingSafeEqual, and the twilio SDK's own
// use of Node APIs), so this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

const TOKEN_TTL_SECONDS = 3600; // 1 hour

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_TWIML_APP_SID",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_USERS",
] as const;

export async function POST(req: Request) {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[api/token] Missing required environment variable: ${key}`);
      return NextResponse.json({ error: "Server misconfiguration. Please contact the administrator." }, { status: 500 });
    }
  }

  // Per-IP, in-memory: free and instant, and sheds most junk - but it only
  // sees one serverless instance, so it is the first line, not the defence.
  const ip = getClientIp(req);
  const perIp = rateLimit(`token:${ip}`, 15, 5 * 60 * 1000);
  if (!perIp.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": Math.ceil(perIp.retryAfterMs / 1000).toString() } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const fields = (body ?? {}) as Record<string, unknown>;
  const username = typeof fields.username === "string" ? fields.username : "";
  const password = typeof fields.password === "string" ? fields.password : "";
  const presentedToken = typeof fields.token === "string" ? fields.token : "";

  let user = presentedToken ? userFromSessionToken(presentedToken) : null;

  if (!user) {
    // The real brute-force defence: a counter every instance shares, keyed
    // by the account being attacked rather than by an IP the attacker
    // chooses. See lib/loginGuard.ts.
    if (username) {
      const lock = await checkLockout(username);
      if (lock.locked) {
        return NextResponse.json(
          { error: "Too many failed sign-ins. This account is locked for a few minutes." },
          { status: 429, headers: { "Retry-After": Math.ceil(lock.retryAfterMs / 1000).toString() } },
        );
      }
    }

    user = verifyUserCredentials(username, password);
    if (!user) {
      if (username) await recordFailure(username);
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }
    await clearFailures(user.username);
  }

  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const accessToken = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_API_KEY_SID!,
    process.env.TWILIO_API_KEY_SECRET!,
    { identity: user.identity, ttl: TOKEN_TTL_SECONDS },
  );

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID!,
    // Lets the dialer ring in the browser when someone calls this user's
    // number, which app/api/voice/incoming/route.ts routes to them by
    // identity. Without this the SDK refuses to register for incoming calls
    // and the only thing that can ever ring is the forwarding phone.
    incomingAllow: true,
  });
  accessToken.addGrant(voiceGrant);

  // Best-effort - a Sync hiccup here shouldn't block signing in, just means
  // the avatar falls back to initials until the next successful token mint.
  let profile: Profile = {};
  try {
    profile = await readProfile(getProfileClient(), user.username);
  } catch (err) {
    console.warn("[api/token] Failed to read profile:", err);
  }

  return NextResponse.json({
    token: accessToken.toJwt(),
    // The browser's own credential from here on - it replaces the password
    // in every later API call, and in what the page keeps in storage.
    sessionToken: issueSessionToken(user.username),
    sessionTtlMs: SESSION_TTL_MS,
    identity: user.identity,
    ttlSeconds: TOKEN_TTL_SECONDS,
    phoneNumber: user.phoneNumber,
    label: user.label,
    avatarUrl: profile.avatarUrl,
    about: profile.about,
    status: profile.status,
  });
}
