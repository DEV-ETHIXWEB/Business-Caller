import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { toPublicCredentialInfo } from "@/lib/webauthn";
import { getWebAuthnClient, readCredentials, writeCredentials } from "@/lib/webauthnStore";

export const runtime = "nodejs";

const REQUIRED_ENV_VARS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_SYNC_SERVICE_SID",
  "APP_USERS",
] as const;

export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "webauthn-devices-list",
    limit: 30,
    windowMs: 5 * 60 * 1000,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user } = auth.data;

  const credentials = await readCredentials(getWebAuthnClient(), user.username);
  return NextResponse.json({ devices: credentials.map(toPublicCredentialInfo) });
}

export async function DELETE(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "webauthn-devices-delete",
    limit: 30,
    windowMs: 5 * 60 * 1000,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const id = typeof fields.id === "string" ? fields.id : "";
  if (!id) {
    return NextResponse.json({ error: "Invalid device id." }, { status: 400 });
  }

  const client = getWebAuthnClient();
  const existing = await readCredentials(client, user.username);
  const next = existing.filter((c) => c.id !== id);
  await writeCredentials(client, user.username, next);

  return NextResponse.json({ devices: next.map(toPublicCredentialInfo) });
}
