"use client";

import { useEffect, useState } from "react";
import { makeEvent, makeLocation, makePoll } from "@/lib/richText";
import { PlusIcon, TrashIcon } from "../icons";
import { FIELD_CLASS, PRIMARY_CLASS, Sheet } from "./Sheet";

export function PollBuilder({ onSend, onClose }: { onSend: (body: string) => void; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const valid = question.trim().length > 0 && filled.length >= 2 && new Set(filled.map((o) => o.toLowerCase())).size === filled.length;

  return (
    <Sheet
      title="Create poll"
      onClose={onClose}
      footer={
        <button type="button" disabled={!valid} onClick={() => { onSend(makePoll(question, filled)); onClose(); }} className={PRIMARY_CLASS}>
          Send poll
        </button>
      }
    >
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" htmlFor="poll-q">
        Question
      </label>
      <input id="poll-q" autoFocus value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={120} placeholder="Ask a question" className={`mt-1 ${FIELD_CLASS}`} />
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Options</p>
      <div className="mt-1 space-y-2">
        {options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={o}
              onChange={(e) => setOptions((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
              maxLength={60}
              placeholder={`Option ${i + 1}`}
              aria-label={`Option ${i + 1}`}
              className={FIELD_CLASS}
            />
            {options.length > 2 && (
              <button type="button" onClick={() => setOptions((cur) => cur.filter((_, j) => j !== i))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-900/5 dark:text-slate-300" aria-label={`Remove option ${i + 1}`}>
                <TrashIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      {options.length < 6 && (
        <button type="button" onClick={() => setOptions((cur) => [...cur, ""])} className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-[#C0272D] dark:text-[#ff6b72]">
          <PlusIcon className="h-4 w-4" /> Add option
        </button>
      )}
      <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        A poll goes out as an ordinary text. People vote by replying with an option&apos;s number, and the votes are counted here.
      </p>
    </Sheet>
  );
}

export function EventBuilder({ onSend, onClose }: { onSend: (body: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [place, setPlace] = useState("");
  const valid = title.trim().length > 0 && when.length > 0;
  // The year is added only when it is not this year, so the text stays short.
  const pretty = when
    ? new Date(when).toLocaleString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
        ...(new Date(when).getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}),
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <Sheet
      title="Create event"
      onClose={onClose}
      footer={
        <button type="button" disabled={!valid} onClick={() => { onSend(makeEvent({ title, when: pretty, place })); onClose(); }} className={PRIMARY_CLASS}>
          Send event
        </button>
      }
    >
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" htmlFor="ev-title">Event name</label>
      <input id="ev-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Team lunch" className={`mt-1 ${FIELD_CLASS}`} />
      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" htmlFor="ev-when">Date and time</label>
      <input id="ev-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={`mt-1 ${FIELD_CLASS}`} />
      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" htmlFor="ev-place">Place (optional)</label>
      <input id="ev-place" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={80} placeholder="Cafe Roma" className={`mt-1 ${FIELD_CLASS}`} />
      <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        People answer by replying YES, NO or MAYBE, and the answers are counted here.
      </p>
    </Sheet>
  );
}

// Shares where you are as a map link. Nothing is sent until you tap Send, and
// only the one position is shared (there is no live tracking over SMS).
export function LocationSheet({ onSend, onClose }: { onSend: (body: string) => void; onClose: () => void }) {
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      const t = setTimeout(() => setError("This device cannot share a location."), 0);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (p) => !cancelled && setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => !cancelled && setError(e.code === 1 ? "Location access is blocked. Allow it for this site in your browser settings." : "Could not find your location. Try again."),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const d = 0.004;
  return (
    <Sheet
      title="Share location"
      onClose={onClose}
      footer={
        <button type="button" disabled={!pos} onClick={() => pos && (onSend(makeLocation(pos.lat, pos.lng, label.trim())), onClose())} className={PRIMARY_CLASS}>
          Send this location
        </button>
      }
    >
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {!pos && !error && <p className="py-6 text-center text-sm text-slate-500">Finding your location…</p>}
      {pos && (
        <>
          <div className="overflow-hidden rounded-xl">
            <iframe
              title="Map preview"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${pos.lng - d},${pos.lat - d},${pos.lng + d},${pos.lat + d}&layer=mapnik&marker=${pos.lat},${pos.lng}`}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
              className="pointer-events-none block h-48 w-full border-0"
            />
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Accurate to about {Math.round(pos.accuracy)} m</p>
          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" htmlFor="loc-label">Name (optional)</label>
          <input id="loc-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="Office" className={`mt-1 ${FIELD_CLASS}`} />
        </>
      )}
    </Sheet>
  );
}
