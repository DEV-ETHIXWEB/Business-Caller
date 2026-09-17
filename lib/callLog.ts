/**
 * Shape returned by app/api/calls/route.ts and consumed by the Calls tab in
 * app/components/Dialer.tsx. Mirrors lib/messageThread.ts's pattern - a
 * standalone type with no Node/DOM imports so both the server route and the
 * client component can use it.
 */
export interface CallLogEntry {
  sid: string;
  direction: "inbound" | "outbound";
  with: string;
  status: string;
  /** Seconds; 0 for calls that never connected (no-answer, busy, failed). */
  durationSeconds: number;
  /** Epoch milliseconds. */
  at: number;
}
