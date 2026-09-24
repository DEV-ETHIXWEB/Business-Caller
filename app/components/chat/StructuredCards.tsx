"use client";

import { tallyEvent, tallyPoll, type ContactCard, type EventData, type LocationData, type PollData, type Vote } from "@/lib/richText";
import { CalendarIcon, MapPinIcon, MessageIcon, PlusIcon, PollIcon, UserCardIcon } from "../icons";
import { Avatar } from "../Avatar";

// Cards for texts that carry more than words. They are ordinary texts on the
// wire, so the other person reads them fine as plain SMS.

const shell = (out: boolean) =>
  `min-w-[13.5rem] max-w-[min(18rem,68vw)] rounded-xl p-2.5 ${out ? "bg-white/15" : "bg-slate-900/[0.04] dark:bg-white/[0.06]"}`;

export function PollCard({ poll, votes, out, onVote }: { poll: PollData; votes: Vote[]; out: boolean; onVote?: (option: number) => void }) {
  const { counts, total } = tallyPoll(poll, votes);
  return (
    <div className={shell(out)} data-testid="poll-card">
      <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide opacity-80">
        <PollIcon className="h-3.5 w-3.5" /> Poll
      </p>
      <p className="mt-1 font-semibold [overflow-wrap:anywhere]">{poll.question}</p>
      <div className="mt-2 space-y-1.5">
        {poll.options.map((option, i) => {
          const pct = total ? Math.round((counts[i] / total) * 100) : 0;
          return (
            <button
              key={i}
              type="button"
              disabled={!onVote}
              onClick={(e) => {
                e.stopPropagation();
                onVote?.(i + 1);
              }}
              className="relative block w-full overflow-hidden rounded-lg border border-current/25 px-2.5 py-1.5 text-left text-[0.8125rem] transition-transform enabled:active:scale-[0.99]"
              aria-label={`${option}: ${counts[i]} vote${counts[i] === 1 ? "" : "s"}`}
            >
              <span className={`absolute inset-y-0 left-0 ${out ? "bg-white/30" : "bg-[#C0272D]/20"}`} style={{ width: `${pct}%` }} aria-hidden />
              <span className="relative flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {i + 1}. {option}
                </span>
                <span className="shrink-0 tabular-nums opacity-80">{counts[i]}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[0.6875rem] opacity-70">{total} vote{total === 1 ? "" : "s"}. Replies with the option number count.</p>
    </div>
  );
}

export function EventCard({ event, votes, out, onRsvp }: { event: EventData; votes: Vote[]; out: boolean; onRsvp?: (answer: "YES" | "NO" | "MAYBE") => void }) {
  const { counts } = tallyEvent(votes);
  return (
    <div className={shell(out)} data-testid="event-card">
      <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide opacity-80">
        <CalendarIcon className="h-3.5 w-3.5" /> Event
      </p>
      <p className="mt-1 font-semibold [overflow-wrap:anywhere]">{event.title}</p>
      <p className="mt-0.5 text-[0.8125rem] opacity-90">{event.when}</p>
      {event.place && (
        <p className="mt-0.5 flex items-center gap-1 text-[0.8125rem] opacity-90">
          <MapPinIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="[overflow-wrap:anywhere]">{event.place}</span>
        </p>
      )}
      <div className="mt-2 flex gap-1.5">
        {(["YES", "NO", "MAYBE"] as const).map((a) => (
          <button
            key={a}
            type="button"
            disabled={!onRsvp}
            onClick={(e) => {
              e.stopPropagation();
              onRsvp?.(a);
            }}
            className="flex-1 rounded-lg border border-current/25 px-2 py-1 text-[0.75rem] font-semibold transition-transform enabled:active:scale-95"
          >
            {a.charAt(0) + a.slice(1).toLowerCase()} {counts[a.toLowerCase() as "yes" | "no" | "maybe"]}
          </button>
        ))}
      </div>
    </div>
  );
}

// A small free map (OpenStreetMap), no key and no cost. It only loads once the
// card is on screen.
export function LocationCard({ loc, out }: { loc: LocationData; out: boolean }) {
  const d = 0.004;
  const bbox = `${loc.lng - d},${loc.lat - d},${loc.lng + d},${loc.lat + d}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${loc.lat},${loc.lng}`;
  return (
    <div className={`${shell(out)} w-[min(18rem,68vw)] p-1.5`} data-testid="location-card">
      <div className="overflow-hidden rounded-lg">
        <iframe
          title="Map"
          src={src}
          loading="lazy"
          referrerPolicy="no-referrer"
          // The map is another site, so allowing its own origin lets it run
          // normally while it still cannot touch this page.
          sandbox="allow-scripts allow-same-origin"
          className="pointer-events-none block h-44 w-full border-0"
        />
      </div>
      <a
        href={`https://maps.google.com/?q=${loc.lat},${loc.lng}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="mt-1.5 flex items-center gap-1.5 px-1 text-[0.8125rem] font-semibold underline underline-offset-2"
      >
        <MapPinIcon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">{loc.label || "Open in Maps"}</span>
      </a>
    </div>
  );
}

export function ContactCardView({
  card,
  out,
  known,
  onMessage,
  onSave,
}: {
  card: ContactCard;
  out: boolean;
  known: boolean;
  onMessage: () => void;
  onSave: () => void;
}) {
  return (
    <div className={shell(out)} data-testid="contact-card">
      <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide opacity-80">
        <UserCardIcon className="h-3.5 w-3.5" /> Contact
      </p>
      <div className="mt-1.5 flex items-center gap-2.5">
        <Avatar label={card.name} size="md" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{card.name}</p>
          <p className="truncate text-[0.8125rem] opacity-85">{card.number}</p>
        </div>
      </div>
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMessage();
          }}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-current/25 px-2 py-1 text-[0.75rem] font-semibold active:scale-95"
        >
          <MessageIcon className="h-3.5 w-3.5" /> Message
        </button>
        {!known && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSave();
            }}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-current/25 px-2 py-1 text-[0.75rem] font-semibold active:scale-95"
          >
            <PlusIcon className="h-3.5 w-3.5" /> Save
          </button>
        )}
      </div>
    </div>
  );
}
