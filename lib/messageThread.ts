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
