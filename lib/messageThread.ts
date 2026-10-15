/**
 * Shape returned by app/api/messages/route.ts and consumed by the Messages
 * panel in app/components/Dialer.tsx. Kept as a standalone type (no Node or
 * DOM-specific imports) so both the server route and the client component
 * can import it without pulling in anything they don't need.
 */
export type MediaKind = "audio" | "image" | "video" | "other";

/** One attachment on a text (MMS): a voice note, photo, and so on. */
export interface ThreadMedia {
  sid: string;
  contentType: string;
  kind: MediaKind;
  /** Signed, time-limited link served by app/api/media/route.ts. */
  url: string;
  /** Only on a voice note or photo just sent from this screen: its real
   * waveform and length, and picture size, known before Twilio has it. */
  peaks?: number[];
  seconds?: number;
}

export function mediaKind(contentType: string): MediaKind {
  const type = contentType.toLowerCase();
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  return "other";
}

export interface ThreadMessage {
  sid: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  /** Epoch milliseconds. */
  at: number;
  media?: ThreadMedia[];
}

/** One row in the conversation list (app/api/conversations/route.ts) - the
 * most recent message with each number that has ever exchanged an SMS with
 * this Twilio number. */
export interface ConversationSummary {
  number: string;
  lastBody: string;
  lastDirection: "inbound" | "outbound";
  /** Epoch milliseconds. */
  lastAt: number;
  /** Set when the latest message carried an attachment, so the list can say
   * "Voice message" or "Photo" instead of showing an empty preview. */
  lastKind?: MediaKind;
}

/** The two fields of a Twilio Message resource that decide whose thread a
 * record belongs in. Kept structural so both the SDK's Message instances
 * and plain test objects satisfy it. */
export interface MessageSides {
  direction: string;
  from: string | null;
  to: string | null;
}

/**
 * Whether a Twilio Message record is *our* copy of a text.
 *
 * Everyone in APP_USERS shares a single Twilio account, so texting a
 * colleague's number leaves two separate Message records for the one text:
 * the outbound copy that left our number, and the inbound copy that arrived
 * at theirs. Both carry the identical `from` and `to`, so a `list({ from:
 * us, to: them })` query hands back both - and the inbound one used to be
 * rendered as a reply, which is why every text to a colleague instantly
 * appeared again as if they had sent it straight back.
 *
 * A record is ours when it is our own side of the exchange: outbound only
 * when we are the sender, inbound only when we are the recipient. The other
 * copy is the colleague's, and belongs in their thread, not ours.
 */
export function isOurCopy(m: MessageSides, ourNumber: string): boolean {
  return m.direction === "inbound" ? m.to === ourNumber : m.from === ourNumber;
}
