"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps retrying a text send in the background - including across a page
 * reload - for as long as the failure looks transient: our own server
 * briefly unreachable, a network blip, a 429/5xx from the API. It never
 * retries a send that was clearly rejected for a reason retrying can't fix
 * (a bad number, a message Twilio itself refused) - see sendErrorIsRetryable
 * in Dialer.tsx for that classification. Retrying those would just spend
 * money failing the same way every time.
 */
export interface QueuedSend {
  id: string;
  to: string;
  body: string;
  /** Omitted (not just empty) for anything with media - those aren't
   * persisted to localStorage, only kept in memory for this page's lifetime,
   * since a photo/voice note as a data URL can be several MB and localStorage
   * is typically capped around 5-10MB total. */
  mediaDataUrls?: string[];
  /** Local blob: preview URLs shown on the pending bubble while this is
   * queued - not sent anywhere, never persisted, just revoked once this
   * entry is finally resolved (sent or given up on). */
  previewUrls?: string[];
  attempt: number;
  nextAttemptAt: number;
  createdAt: number;
}

export type SendAttemptResult = { ok: true; sid: string } | { ok: false; retryable: boolean; error: string };

const MAX_ATTEMPTS = 8;
// ~5s, 15s, 30s, 1m, 2m, 5m, 10m, 15m - about 35 minutes of retrying before
// giving up, long enough to ride out a deploy or a brief outage without
// hammering Twilio or leaving someone staring at "sending..." forever.
const BACKOFF_SCHEDULE_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000];

function storageKey(username: string) {
  return `dialer_sendqueue:${username}`;
}

function loadPersisted(username: string): QueuedSend[] {
  try {
    const raw = localStorage.getItem(storageKey(username));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePersisted(username: string, queue: QueuedSend[]) {
  try {
    // Only text-only entries are worth persisting - see the mediaDataUrls
    // note above.
    const persistable = queue.filter((q) => !q.mediaDataUrls?.length);
    if (persistable.length) localStorage.setItem(storageKey(username), JSON.stringify(persistable));
    else localStorage.removeItem(storageKey(username));
  } catch {
    // Storage full or unavailable - the queue still works for this page's
    // lifetime, it just won't survive a reload.
  }
}

export function useSendQueue(
  username: string | null,
  attempt: (item: QueuedSend) => Promise<SendAttemptResult>,
  onSettled: (item: QueuedSend, result: SendAttemptResult | { ok: false; retryable: false; error: string; gaveUp: true }) => void,
) {
  // Tracks which username the queue below was loaded for, so a sign-out/
  // sign-in (a username change, not a remount) re-reads that user's own
  // queue instead of carrying the previous one over. Adjusting state during
  // render like this - rather than in an effect - is the pattern React
  // itself recommends for "reset state when a prop changes".
  const [loadedFor, setLoadedFor] = useState(username);
  const [queue, setQueue] = useState<QueuedSend[]>(() => (username ? loadPersisted(username) : []));
  if (username !== loadedFor) {
    setLoadedFor(username);
    setQueue(username ? loadPersisted(username) : []);
  }

  const attemptRef = useRef(attempt);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    attemptRef.current = attempt;
    onSettledRef.current = onSettled;
  }, [attempt, onSettled]);

  const inFlight = useRef<Set<string>>(new Set());

  const mutate = useCallback(
    (next: QueuedSend[] | ((q: QueuedSend[]) => QueuedSend[])) => {
      setQueue((cur) => {
        const resolved = typeof next === "function" ? (next as (q: QueuedSend[]) => QueuedSend[])(cur) : next;
        if (username) savePersisted(username, resolved);
        return resolved;
      });
    },
    [username],
  );

  const enqueue = useCallback(
    (item: Omit<QueuedSend, "attempt" | "nextAttemptAt" | "createdAt">) => {
      const now = Date.now();
      mutate((cur) => [...cur, { ...item, attempt: 0, nextAttemptAt: now, createdAt: now }]);
    },
    [mutate],
  );

  const cancel = useCallback(
    (id: string) => {
      mutate((cur) => cur.filter((q) => q.id !== id));
    },
    [mutate],
  );

  // Checked once a second rather than one timeout per item, so a
  // backgrounded/throttled tab just catches up whenever it's next checked
  // instead of silently dropping a scheduled attempt.
  useEffect(() => {
    if (!username || !queue.length) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const item of queue) {
        if (item.nextAttemptAt > now || inFlight.current.has(item.id)) continue;
        inFlight.current.add(item.id);
        attemptRef.current(item).then(
          (result) => {
            inFlight.current.delete(item.id);
            if (result.ok) {
              mutate((cur) => cur.filter((q) => q.id !== item.id));
              onSettledRef.current(item, result);
              return;
            }
            const outOfAttempts = item.attempt + 1 >= MAX_ATTEMPTS;
            if (!result.retryable || outOfAttempts) {
              mutate((cur) => cur.filter((q) => q.id !== item.id));
              onSettledRef.current(item, outOfAttempts && result.retryable ? { ok: false, retryable: false, error: result.error, gaveUp: true } : result);
              return;
            }
            const delay = BACKOFF_SCHEDULE_MS[Math.min(item.attempt, BACKOFF_SCHEDULE_MS.length - 1)];
            mutate((cur) => cur.map((q) => (q.id === item.id ? { ...q, attempt: q.attempt + 1, nextAttemptAt: Date.now() + delay } : q)));
          },
          () => {
            inFlight.current.delete(item.id);
          },
        );
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [username, queue, mutate]);

  return { queue, enqueue, cancel };
}
