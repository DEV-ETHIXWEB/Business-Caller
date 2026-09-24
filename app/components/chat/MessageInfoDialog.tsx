"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ThreadMessage } from "@/lib/messageThread";
import { CloseIcon } from "../icons";

export interface MessageInfo {
  sid: string;
  direction: string;
  status: string;
  from: string;
  to: string;
  dateCreated: number | null;
  dateSent: number | null;
  dateUpdated: number | null;
  segments: number | null;
  media: number;
  price: string | null;
  priceUnit: string | null;
  errorCode: number | null;
  errorMessage: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  accepted: "Accepted, waiting to send",
  queued: "Queued",
  sending: "Sending",
  sent: "Sent to the carrier",
  delivered: "Delivered to the phone",
  undelivered: "Not delivered",
  failed: "Failed",
  received: "Received",
  receiving: "Receiving",
  read: "Read",
  partially_delivered: "Partly delivered",
};

const when = (t: number | null) =>
  t ? new Date(t).toLocaleString([], { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Not available";

function money(price: string | null, unit: string | null): string {
  if (price === null || price === "") return "Not billed yet";
  const n = Math.abs(Number(price));
  if (!Number.isFinite(n)) return "Not available";
  return `${(unit ?? "USD") === "USD" ? "$" : ""}${n.toFixed(4)}${unit && unit !== "USD" ? ` ${unit}` : ""}`;
}

// "Message info": what Twilio recorded for one text.
export function MessageInfoDialog({ message, load, onClose }: { message: ThreadMessage; load: (sid: string) => Promise<MessageInfo>; onClose: () => void }) {
  const [info, setInfo] = useState<MessageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load(message.sid).then(
      (i) => !cancelled && setInfo(i),
      (e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load the details."),
    );
    return () => {
      cancelled = true;
    };
  }, [load, message.sid]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const out = message.direction === "outbound";
  const rows: [string, string][] = info
    ? [
        ["Status", STATUS_LABEL[info.status] ?? info.status],
        [out ? "Sent" : "Received", when(info.dateSent ?? info.dateCreated)],
        ["Last update", when(info.dateUpdated)],
        ["From", info.from],
        ["To", info.to],
        ["Text segments", info.segments ? String(info.segments) : "Not available"],
        ...(info.media ? ([["Attachments", String(info.media)]] as [string, string][]) : []),
        ["Cost", money(info.price, info.priceUnit)],
        ...(info.errorCode ? ([["Problem", `${info.errorMessage ?? "Error"} (code ${info.errorCode})`]] as [string, string][]) : []),
        ["Message ID", info.sid],
      ]
    : [];

  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/40 backdrop-blur-sm animate-[fade-in_0.15s_ease-out] lg:items-center lg:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Message info"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/70 bg-white shadow-[0_-20px_50px_-15px_rgba(15,23,42,0.4)] animate-[slide-fade-in_0.2s_ease-out] dark:border-white/10 dark:bg-[#17181c] lg:max-w-md lg:rounded-3xl"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Message info</h2>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/10" aria-label="Close">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <p className="mx-5 mb-3 line-clamp-3 rounded-xl bg-slate-900/5 px-3 py-2 text-sm text-slate-600 [overflow-wrap:anywhere] dark:bg-white/5 dark:text-slate-300">
          {message.body || (message.media?.length ? "Attachment" : "Message")}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {error && <p className="py-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
          {!info && !error && <p className="py-4 text-sm text-slate-400">Loading from Twilio…</p>}
          <dl className="divide-y divide-slate-900/5 dark:divide-white/5">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{k}</dt>
                <dd className="min-w-0 text-right text-sm text-slate-800 [overflow-wrap:anywhere] dark:text-slate-100">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>,
    document.body,
  );
}
