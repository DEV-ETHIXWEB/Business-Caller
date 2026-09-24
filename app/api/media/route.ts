import { NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { MEDIA_SID_RE, MESSAGE_SID_RE, MediaFetchError, fetchTwilioMedia, verifyMediaSignature } from "@/lib/media";

// Requires Node's crypto module, so this must run on the Node.js runtime.
export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024;

// Only these are ever shown inline; anything else is forced to download, so
// an attachment can never run as a page (an SVG with script, say).
const INLINE_TYPE_RE = /^(audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|image\/(png|jpeg|jpg|gif|webp|heic|heif))$/i;

// Serves one attachment of a text message. Not a login route: the link is
// signed by /api/messages (which only signs attachments in the caller's own
// conversation) and expires, so this can be used straight from an <audio> or
// <img> tag.
export async function GET(req: Request) {
  const missing = ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("[api/media] Missing required environment variable(s):", missing.join(", "));
    return NextResponse.json({ error: "Server misconfiguration." }, { status: 500 });
  }

  const limit = rateLimit(`media:${getClientIp(req)}`, 400, 5 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const url = new URL(req.url);
  const messageSid = url.searchParams.get("m") ?? "";
  const mediaSid = url.searchParams.get("a") ?? "";
  const exp = Number(url.searchParams.get("e"));
  const sig = url.searchParams.get("s") ?? "";

  if (!MESSAGE_SID_RE.test(messageSid) || !MEDIA_SID_RE.test(mediaSid) || !verifyMediaSignature(messageSid, mediaSid, exp, sig)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let bytes: Buffer;
  let contentType: string;
  try {
    ({ bytes, contentType } = await fetchTwilioMedia(messageSid, mediaSid, MAX_BYTES));
  } catch (err) {
    if (err instanceof MediaFetchError) {
      return NextResponse.json({ error: err.status === 413 ? "Attachment too large." : "Not found." }, { status: err.status === 404 ? 404 : err.status === 413 ? 413 : 502 });
    }
    console.error("[api/media] Twilio fetch failed:", err);
    return NextResponse.json({ error: "Could not load the attachment." }, { status: 502 });
  }

  const inline = INLINE_TYPE_RE.test(contentType);
  const headers: Record<string, string> = {
    "Content-Type": inline ? contentType : "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (!inline) headers["Content-Disposition"] = "attachment";

  // Safari will not play audio unless byte ranges are honoured.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const total = bytes.byteLength;
    let start = range[1] ? parseInt(range[1], 10) : Math.max(0, total - parseInt(range[2], 10));
    let end = range[1] && range[2] ? parseInt(range[2], 10) : total - 1;
    end = Math.min(end, total - 1);
    if (start > end || start >= total) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }
    start = Math.max(0, start);
    const slice = bytes.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(slice), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(slice.byteLength) },
    });
  }

  return new NextResponse(new Uint8Array(bytes), { status: 200, headers: { ...headers, "Content-Length": String(bytes.byteLength) } });
}
