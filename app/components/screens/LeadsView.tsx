"use client";

import { Avatar } from "../Avatar";
import { MapPinIcon, MessageIcon, PhoneIcon } from "../icons";
import { mapLink, type Lead, type LeadPriority } from "@/lib/leads";

// The day's new work, as a list of jobs rather than a chat thread.
//
// These summaries have always arrived - the answering service texts one
// over every time it takes a call - but they arrived as plain text in the
// Texts tab, so acting on one meant reading a paragraph to find the number,
// copying the address out by hand, and scrolling back to check which was
// urgent. Everything here was already in that text. None of it was usable.

const PRIORITY_STYLES: Record<LeadPriority, { dot: string; chip: string; label: string }> = {
  urgent: {
    dot: "bg-[#C0272D] shadow-[0_0_8px_2px_rgba(192,39,45,0.5)]",
    chip: "bg-[#C0272D]/10 text-[#C0272D] dark:bg-[#C0272D]/20 dark:text-[#ff8087]",
    label: "Urgent",
  },
  estimate: {
    dot: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    label: "Estimate",
  },
  routine: {
    dot: "bg-slate-400",
    chip: "bg-slate-900/5 text-slate-600 dark:bg-white/10 dark:text-slate-300",
    label: "Routine",
  },
};

const ACTION_CLASS =
  "flex items-center gap-1.5 rounded-full border border-white/60 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-all active:scale-95 dark:border-white/10 dark:bg-white/5 dark:text-slate-300";

export interface LeadsViewProps {
  leads: Lead[];
  loading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onCall: (number: string) => void;
  onMessage: (number: string) => void;
  /** Texts the claim word back to the answering service. */
  onClaim: (lead: Lead) => void;
  claimedSids: string[];
  relativeDay: (at: number) => string;
}

export function LeadsView({
  leads,
  loading,
  search,
  onSearchChange,
  onCall,
  onMessage,
  onClaim,
  claimedSids,
  relativeDay,
}: LeadsViewProps) {
  const q = search.trim().toLowerCase();
  const visible = q
    ? leads.filter((l) =>
        [l.customerName, l.problem, l.address, l.customerNumber, l.jobType]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    : leads;

  const urgentCount = leads.filter((l) => l.priority === "urgent" && !claimedSids.includes(l.sid)).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-wide text-slate-900 dark:text-white">Leads</h1>
        <div className="flex items-center gap-2">
          {urgentCount > 0 && (
            <span className="rounded-full bg-[#C0272D] px-2 py-0.5 text-[0.625rem] font-bold text-white" role="status">
              {urgentCount} urgent
            </span>
          )}
          {loading && <span className="text-[0.625rem] text-slate-400 dark:text-slate-500">syncing…</span>}
        </div>
      </div>

      <div className="relative mt-3">
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search leads"
          aria-label="Search leads"
          className="w-full rounded-xl border border-white/70 bg-white/60 px-3 py-2 text-sm text-slate-900 shadow-[inset_0_2px_6px_rgba(15,23,42,0.08)] outline-none backdrop-blur-sm transition placeholder:text-slate-400 focus:border-[#C0272D]/40 focus:bg-white/90 focus:ring-4 focus:ring-[#C0272D]/15 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:placeholder:text-slate-500"
        />
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pb-24 lg:pb-4">
        {!loading && visible.length === 0 && (
          <p className="p-4 text-center text-sm leading-relaxed text-slate-400 dark:text-slate-500">
            {leads.length === 0
              ? "No leads yet. When the answering service takes a call, the summary it texts over shows up here as a job you can call, map and claim."
              : "No leads match your search."}
          </p>
        )}

        {visible.map((lead) => {
          const style = PRIORITY_STYLES[lead.priority];
          const claimed = claimedSids.includes(lead.sid);
          return (
            <div
              key={lead.sid}
              className={`rounded-2xl border bg-white/70 p-3.5 backdrop-blur-sm transition-all dark:bg-white/[0.04] ${
                claimed
                  ? "border-white/50 opacity-60 dark:border-white/5"
                  : lead.priority === "urgent"
                    ? "border-[#C0272D]/25 dark:border-[#C0272D]/30"
                    : "border-white/70 dark:border-white/10"
              }`}
            >
              <div className="flex items-start gap-3">
                <Avatar label={lead.customerName} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
                    <span className={`rounded-full px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide ${style.chip}`}>
                      {style.label}
                    </span>
                    {lead.jobType && (
                      <span className="truncate text-[0.625rem] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        {lead.jobType}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[0.6875rem] text-slate-400 dark:text-slate-500">
                      {relativeDay(lead.at)}
                    </span>
                  </div>

                  <p className="mt-1 truncate text-[0.9375rem] font-semibold text-slate-800 dark:text-slate-100">
                    {lead.customerName}
                    {claimed && <span className="ml-1.5 text-[0.6875rem] font-normal text-slate-400">· claimed</span>}
                  </p>

                  {lead.customerNumber && (
                    <p className="truncate text-[0.8125rem] tabular-nums text-slate-500 dark:text-slate-400">{lead.customerNumber}</p>
                  )}
                </div>
              </div>

              {lead.problem && (
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-slate-600 dark:text-slate-300">{lead.problem}</p>
              )}

              {lead.address && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[0.8125rem] text-slate-500 dark:text-slate-400">
                  <MapPinIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0">{lead.address}</span>
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-1.5">
                {lead.customerNumber && (
                  <>
                    <button type="button" onClick={() => onCall(lead.customerNumber!)} className={ACTION_CLASS}>
                      <PhoneIcon className="h-3.5 w-3.5" />
                      Call
                    </button>
                    <button type="button" onClick={() => onMessage(lead.customerNumber!)} className={ACTION_CLASS}>
                      <MessageIcon className="h-3.5 w-3.5" />
                      Text
                    </button>
                  </>
                )}
                {lead.address && (
                  <a
                    href={mapLink(lead.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={ACTION_CLASS}
                  >
                    <MapPinIcon className="h-3.5 w-3.5" />
                    Directions
                  </a>
                )}
                {lead.claimWord && !claimed && (
                  <button
                    type="button"
                    onClick={() => onClaim(lead)}
                    className="ml-auto flex items-center gap-1.5 rounded-full bg-gradient-to-b from-[#e0555c] to-[#C0272D] px-3.5 py-1.5 text-xs font-semibold text-white transition-all active:scale-95"
                  >
                    {lead.claimWord}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
