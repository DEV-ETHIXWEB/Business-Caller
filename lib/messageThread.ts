/**
 * Shape returned by app/api/messages/route.ts and consumed by the Messages
 * panel in app/components/Dialer.tsx. Kept as a standalone type (no Node or
 * DOM-specific imports) so both the server route and the client component
 * can import it without pulling in anything they don't need.
 */
export interface ThreadMessage {
  sid: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  /** Epoch milliseconds. */
  at: number;
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
}
