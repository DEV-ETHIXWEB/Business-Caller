import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { requireUser } from "@/lib/auth";
import { getRpID } from "@/lib/webauthn";
import { getWebAuthnClient, readCredentials } from "@/lib/webauthnStore";

export const runtime = "nodejs";

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_USERS",
  "PUBLIC_BASE_URL",
] as const;

// Registering a new Face ID / Touch ID credential requires the real
// username and password first - otherwise anyone who found the URL could
// register their own face/fingerprint as a permanent backdoor into someone
// else's line. This is the only gate; once registered, the credential
// itself is what proves identity from then on.
export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "webauthn-reg-opts",
    limit: 20,
    windowMs: 5 * 60 * 1000,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user } = auth.data;

  const rpID = getRpID();
  if (!rpID) {
    return NextResponse.json(
      { error: "Server misconfiguration: PUBLIC_BASE_URL is not a valid URL." },
      { status: 500 },
    );
  }

  const client = getWebAuthnClient();
  const existing = await readCredentials(client, user.username);

  const options = await generateRegistrationOptions({
    rpName: "Business Caller",
    rpID,
    userName: user.username,
    userDisplayName: user.label,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  return NextResponse.json({ options });
}
