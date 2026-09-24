import { randomUUID } from "crypto";
import type twilio from "twilio";
import { put, list, del } from "@vercel/blob";
import { MEDIA_SID_RE, MESSAGE_SID_RE, MediaFetchError, fetchTwilioMedia } from "@/lib/media";

// Server-only. Turns what a client sends (data URLs of new attachments, or a
// reference to an attachment already in Twilio, for "forward") into public
// links Twilio can fetch when it sends the MMS.

// Attachments go out as MMS. The client shrinks photos and encodes voice notes
// small; this is the hard backstop. It stays under Vercel's ~4.5MB request
// limit once base64 is counted.
export const MAX_MEDIA_BYTES = 3 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;

// What MMS carriers will take. (Word, Excel and the like are not on the list:
// MMS cannot carry them.)
export const MEDIA_TYPES: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/3gpp": "3gp",
  "audio/amr": "amr",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
  "text/vcard": "vcf",
  "text/x-vcard": "vcf",
};

// Old uploads are only needed for the moment Twilio fetches them at send
// time, so they are swept out after a few days.
const MEDIA_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

export function parseMediaDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:([a-zA-Z0-9/+.-]+)(?:;[a-zA-Z0-9=.,_ -]+)*;base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!(mime in MEDIA_TYPES)) return null;
  return { mime, buffer: Buffer.from(match[2], "base64") };
}

export async function sweepOldMedia() {
  try {
    const { blobs } = await list({ prefix: "outgoing/", limit: 200 });
    const stale = blobs.filter((b) => Date.now() - b.uploadedAt.getTime() > MEDIA_RETENTION_MS);
    if (stale.length) await del(stale.map((b) => b.url));
  } catch (err) {
    console.warn("[outgoingMedia] Sweep failed:", err);
  }
}

export interface MediaFailure {
  error: string;
  status: number;
}

interface Item {
  mime: string;
  buffer: Buffer;
}

// Reads the attachments from a request body and checks them all before
// anything is uploaded. Returns them ready to upload, or the reason to refuse.
export async function collectAttachments(
  fields: Record<string, unknown>,
  client: ReturnType<typeof twilio>,
  ownNumber: string,
): Promise<{ items: Item[] } | MediaFailure> {
  const items: Item[] = [];
  let total = 0;

  const rawList: unknown[] = Array.isArray(fields.media) ? fields.media : typeof fields.media === "string" && fields.media ? [fields.media] : [];
  const forward: unknown[] = Array.isArray(fields.forwardMedia) ? fields.forwardMedia : [];
  if (rawList.length + forward.length > MAX_ATTACHMENTS) {
    return { error: `You can attach up to ${MAX_ATTACHMENTS} files at a time.`, status: 400 };
  }

  for (const raw of rawList) {
    if (typeof raw !== "string") return { error: "Unsupported attachment type.", status: 400 };
    const parsed = parseMediaDataUrl(raw);
    if (!parsed) return { error: "Unsupported attachment type. Photos, GIFs, video, audio, PDF and contact cards can be texted.", status: 400 };
    if (parsed.buffer.byteLength === 0) return { error: "That attachment is empty.", status: 400 };
    total += parsed.buffer.byteLength;
    items.push(parsed);
  }

  // "Forward": an attachment already in a text in this person's own history.
  for (const ref of forward) {
    const r = ref as { messageSid?: unknown; mediaSid?: unknown };
    if (typeof r?.messageSid !== "string" || typeof r?.mediaSid !== "string" || !MESSAGE_SID_RE.test(r.messageSid) || !MEDIA_SID_RE.test(r.mediaSid)) {
      return { error: "Invalid attachment to forward.", status: 400 };
    }
    // One Twilio account serves everyone, so prove the text is in this
    // person's own conversations before copying anything out of it.
    try {
      const m = await client.messages(r.messageSid).fetch();
      if (m.to !== ownNumber && m.from !== ownNumber) return { error: "Message not found.", status: 404 };
      const { bytes, contentType } = await fetchTwilioMedia(r.messageSid, r.mediaSid, MAX_MEDIA_BYTES);
      if (!(contentType in MEDIA_TYPES)) return { error: "That kind of attachment cannot be forwarded.", status: 400 };
      total += bytes.byteLength;
      items.push({ mime: contentType, buffer: bytes });
    } catch (err) {
      if (err instanceof MediaFetchError) return { error: err.status === 413 ? "That attachment is too large to forward." : "Could not load the attachment to forward.", status: err.status === 404 ? 404 : 502 };
      if (typeof err === "object" && err !== null && (err as { status?: number }).status === 404) return { error: "Message not found.", status: 404 };
      console.error("[outgoingMedia] Forward fetch failed:", err);
      return { error: "Could not load the attachment to forward.", status: 502 };
    }
  }

  if (total > MAX_MEDIA_BYTES) {
    return { error: "The attachments are too large together. Try fewer, a shorter recording, or a smaller photo.", status: 400 };
  }
  return { items };
}

export async function uploadAttachments(username: string, items: Item[]): Promise<string[]> {
  const urls: string[] = [];
  for (const item of items) {
    const name = `outgoing/${username}-${Date.now()}-${randomUUID()}.${MEDIA_TYPES[item.mime]}`;
    const blob = await put(name, item.buffer, { access: "public", contentType: item.mime });
    urls.push(blob.url);
  }
  if (Math.random() < 0.1) void sweepOldMedia();
  return urls;
}
