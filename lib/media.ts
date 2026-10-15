import type twilio from "twilio";
import { mediaKind, type ThreadMedia } from "./messageThread";
import { sign, verify } from "./secrets";

// Server-only. Attachments (MMS) live in Twilio behind account credentials,
// which a browser <audio> or <img> tag cannot send. So the thread API hands
// out signed, time-limited links to /api/media, and that route fetches the
// file from Twilio with the server's credentials.

const SIGN_WINDOW_SECONDS = 6 * 60 * 60;

export const MESSAGE_SID_RE = /^(SM|MM)[0-9a-fA-F]{32}$/;
export const MEDIA_SID_RE = /^ME[0-9a-fA-F]{32}$/;

// The link is bound to the person it was issued to. Without the username
// in here, any signed link worked for anyone who ever saw it - a
// screenshot, a browser history entry, a referrer - for as long as it had
// left to run. The signing key is derived per-purpose (lib/secrets.ts), so
// it is no longer the Twilio API key doing double duty either.
function payload(username: string, messageSid: string, mediaSid: string, exp: number): string {
  return `${username}.${messageSid}.${mediaSid}.${exp}`;
}

// The expiry is rounded up to a 6 hour boundary, so the link for a given
// attachment stays identical between the 5 second polls (no image reloading
// or audio resetting) and only changes a few times a day.
export function signedMediaUrl(username: string, messageSid: string, mediaSid: string): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = (Math.floor(now / SIGN_WINDOW_SECONDS) + 2) * SIGN_WINDOW_SECONDS;
  const params = new URLSearchParams({
    m: messageSid,
    a: mediaSid,
    e: String(exp),
    u: username,
    s: sign("media-link", payload(username, messageSid, mediaSid, exp)),
  });
  return `/api/media?${params.toString()}`;
}

export function verifyMediaSignature(
  username: string,
  messageSid: string,
  mediaSid: string,
  exp: number,
  sig: string,
): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return verify("media-link", payload(username, messageSid, mediaSid, exp), sig);
}

interface RawMedia {
  sid: string;
  contentType: string;
}

// A message's attachments never change once it exists, so the list is cached
// for the life of the server instance instead of asked again on every poll.
const mediaListCache = new Map<string, RawMedia[]>();
const MAX_CACHE = 500;

// MMS often carries an extra SMIL layout part and a plain-text part that are
// plumbing, not something to show.
function isDisplayable(contentType: string): boolean {
  const type = contentType.toLowerCase();
  return !(type.startsWith("application/smil") || type.startsWith("text/plain"));
}

export async function getMessageMedia(
  client: ReturnType<typeof twilio>,
  messageSid: string,
  username: string,
): Promise<ThreadMedia[]> {
  let raw = mediaListCache.get(messageSid);
  if (!raw) {
    const list = await client.messages(messageSid).media.list({ limit: 6 });
    raw = list.map((m) => ({ sid: m.sid, contentType: m.contentType }));
    if (mediaListCache.size >= MAX_CACHE) mediaListCache.clear();
    mediaListCache.set(messageSid, raw);
  }
  return raw
    .filter((m) => isDisplayable(m.contentType))
    .map((m) => ({
      sid: m.sid,
      contentType: m.contentType,
      kind: mediaKind(m.contentType),
      url: signedMediaUrl(username, messageSid, m.sid),
    }));
}

// Downloads one attachment from Twilio with the server's credentials. Used by
// the /api/media viewer and by "forward" (which re-uploads it for another chat).
// TWILIO_API_BASE only exists so the tests can point this at a fake.
export async function fetchTwilioMedia(messageSid: string, mediaSid: string, maxBytes: number): Promise<{ bytes: Buffer; contentType: string }> {
  const auth = Buffer.from(`${process.env.TWILIO_API_KEY_SID}:${process.env.TWILIO_API_KEY_SECRET}`).toString("base64");
  const base = process.env.TWILIO_API_BASE || "https://api.twilio.com";
  const source = `${base}/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages/${messageSid}/Media/${mediaSid}`;
  const upstream = await fetch(source, { headers: { Authorization: `Basic ${auth}` }, redirect: "follow" });
  if (!upstream.ok) throw new MediaFetchError(upstream.status);
  const bytes = Buffer.from(await upstream.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new MediaFetchError(413);
  return { bytes, contentType: (upstream.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim() };
}

export class MediaFetchError extends Error {
  constructor(public status: number) {
    super(`Media fetch failed (${status})`);
  }
}
