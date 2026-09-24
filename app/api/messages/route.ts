import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireUser } from "@/lib/auth";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import type { ThreadMessage } from "@/lib/messageThread";
import { getMessageMedia } from "@/lib/media";

// Requires Node's crypto module (via requireUser / the twilio SDK), so
// this must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

// This endpoint is polled every few seconds while a conversation is open in
// the Messages panel, so it needs a much higher ceiling than the send/token
// endpoints. It's read-only against Twilio (no SMS is sent or received by
// calling this), so a generous limit costs nothing but a little API quota.
const IP_RATE_LIMIT = 90;
const IP_RATE_WINDOW_MS = 5 * 60 * 1000;
const THREAD_PAGE_SIZE = 50;

const REQUIRED_ENV_VARS = ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "APP_USERS"] as const;

const MESSAGE_SID_PATTERN = /^SM[0-9a-fA-F]{32}$/;

export async function POST(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "messages",
    limit: IP_RATE_LIMIT,
    windowMs: IP_RATE_WINDOW_MS,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const withNumber = normalizePhoneNumber(typeof fields.with === "string" ? fields.with : "");
  if (!isValidE164(withNumber)) {
    return NextResponse.json({ error: "Invalid number." }, { status: 400 });
  }

  const client = twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });

  const ourNumber = user.phoneNumber;

  try {
    // Twilio records every inbound and outbound message against the account
    // regardless of any webhook configuration, so reading it back here is
    // the actual source of truth for "did they reply" - no separate
    // database or inbound webhook needed. list() only filters by a single
    // `to`/`from` at a time, so a two-party thread needs both directions
    // fetched and merged.
    const [outbound, inbound] = await Promise.all([
      client.messages.list({ from: ourNumber, to: withNumber, limit: THREAD_PAGE_SIZE }),
      client.messages.list({ from: withNumber, to: ourNumber, limit: THREAD_PAGE_SIZE }),
    ]);

    const messages: ThreadMessage[] = await Promise.all(
      [...outbound, ...inbound].map(async (m) => {
        const message: ThreadMessage = {
          sid: m.sid,
          direction: (m.direction === "inbound" ? "inbound" : "outbound") as ThreadMessage["direction"],
          body: m.body,
          status: m.status,
          at: (m.dateCreated ?? new Date()).getTime(),
        };
        // Attachments (voice notes, photos) - only asked about for texts
        // that actually have one. A failure here just hides the attachment
        // rather than failing the whole thread.
        if (Number(m.numMedia) > 0) {
          try {
            const media = await getMessageMedia(client, m.sid);
            if (media.length) message.media = media;
          } catch (err) {
            console.warn("[api/messages] Could not load attachments for", m.sid, err);
          }
        }
        return message;
      }),
    );
    messages.sort((a, b) => a.at - b.at);

    return NextResponse.json({ messages });
  } catch (err) {
    console.error("[api/messages] Twilio fetch failed:", err);
    return NextResponse.json({ error: "Failed to load messages." }, { status: 502 });
  }
}

// Deletes a single message. This calls Twilio's own delete on the Message
// resource - the message is permanently removed from Twilio's records, not
// just hidden in this UI. There is nothing to undo this with.
export async function DELETE(req: Request) {
  const auth = await requireUser(req, {
    rateLimitKey: "messages-delete",
    limit: 30,
    windowMs: IP_RATE_WINDOW_MS,
    requiredEnvVars: REQUIRED_ENV_VARS,
  });
  if (!auth.ok) return auth.response;
  const { user, body: fields } = auth.data;

  const sid = typeof fields.sid === "string" ? fields.sid : "";
  if (!MESSAGE_SID_PATTERN.test(sid)) {
    return NextResponse.json({ error: "Invalid message SID." }, { status: 400 });
  }

  const client = twilio(process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!, {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
  });

  try {
    // All users share one Twilio account, so a message SID alone doesn't
    // prove it belongs to this user's own number - fetch it first and
    // confirm before deleting, so one person can't delete another
    // person's messages even if they somehow had the SID.
    const message = await client.messages(sid).fetch();
    if (message.to !== user.phoneNumber && message.from !== user.phoneNumber) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }
    await client.messages(sid).remove();
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("[api/messages] Twilio delete failed:", err);
    return NextResponse.json({ error: "Failed to delete message." }, { status: 502 });
  }
}
