import { NextResponse } from "next/server";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { requireUser } from "@/lib/auth";
import { getRpID, getExpectedOrigin, toPublicCredentialInfo, type StoredCredential } from "@/lib/webauthn";
import { getWebAuthnClient, readCredentials, writeCredentials } from "@/lib/webauthnStore";

export const runtime = "nodejs";

const MAX_LABEL_LENGTH = 60;

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_USERS",
  "PUBLIC_BASE_URL",
] as const;

export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "webauthn-reg-verify",
    limit: 20,
    windowMs: 5 * 60 * 1000,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const response = fields.response as RegistrationResponseJSON | undefined;
  const expectedChallenge = typeof fields.expectedChallenge === "string" ? fields.expectedChallenge : "";
  const deviceLabel =
    typeof fields.deviceLabel === "string" && fields.deviceLabel.trim()
      ? fields.deviceLabel.trim().slice(0, MAX_LABEL_LENGTH)
      : "Unnamed device";

  if (!response || !expectedChallenge) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const rpID = getRpID();
  const origin = getExpectedOrigin();
  if (!rpID || !origin) {
    return NextResponse.json(
      { error: "Server misconfiguration: PUBLIC_BASE_URL is not a valid URL." },
      { status: 500 },
    );
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (err) {
    console.error("[api/webauthn/register-verify] verification threw:", err);
    return NextResponse.json({ error: "Could not verify registration." }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Registration could not be verified." }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  const stored: StoredCredential = {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64"),
    counter: credential.counter,
    transports: credential.transports,
    deviceLabel,
    createdAt: Date.now(),
  };

  const client = getWebAuthnClient();
  const existing = await readCredentials(client, user.username);
  const next = [...existing.filter((c) => c.id !== stored.id), stored];
  await writeCredentials(client, user.username, next);

  return NextResponse.json({ verified: true, devices: next.map(toPublicCredentialInfo) });
}
