"use client";

import { useState } from "react";
import { Avatar } from "../Avatar";
import { ArrowLeftIcon, MessageIcon, PencilIcon, PhoneIcon, PlusIcon, TrashIcon } from "../icons";
import { allNumbers, type Contact, type ContactNumber } from "@/lib/contacts";
import { isValidE164, normalizePhoneNumber } from "@/lib/phone";
import type { CallLogEntry } from "@/lib/callLog";

// One person's page: everything known about them, and the things you'd want
// to do next.
//
// Before this, a contact was three fields in a list row with no way to open
// it and no way to edit it - a typo meant deleting and re-adding, and there
// was nowhere to note a gate code or a second number. The Phone Book had
// one contact in it across the whole team, which is what that friction
// looks like.

const LABEL_OPTIONS = ["Mobile", "Work", "Home", "Other"];

export interface ContactDetailProps {
  contact: Contact;
  /** That person's calls, newest first - already filtered by the caller. */
  calls: CallLogEntry[];
  onClose: () => void;
  onCall: (number: string) => void;
  onMessage: (number: string) => void;
  onSave: (contact: Contact) => void;
  onDelete: (contact: Contact) => void;
  /** Renders a call's status line, so this matches the Calls tab exactly. */
  statusLabel: (entry: CallLogEntry) => string;
  relativeDay: (at: number) => string;
  isMissed: (entry: CallLogEntry) => boolean;
}

const FIELD_CLASS =
  "w-full rounded-2xl border border-white/70 bg-white/70 px-3.5 py-2.5 text-[0.9375rem] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#C0272D]/40 focus:ring-4 focus:ring-[#C0272D]/15 dark:border-white/10 dark:bg-white/5 dark:text-slate-50 dark:placeholder:text-slate-500";

const ACTION_CLASS =
  "flex flex-1 flex-col items-center gap-1.5 rounded-2xl border border-white/60 bg-white/60 py-3 text-xs font-medium text-slate-600 transition-all active:scale-95 dark:border-white/10 dark:bg-white/5 dark:text-slate-300";

export function ContactDetail({
  contact,
  calls,
  onClose,
  onCall,
  onMessage,
  onSave,
  onDelete,
  statusLabel,
  relativeDay,
  isMissed,
}: ContactDetailProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(contact.name);
  const [company, setCompany] = useState(contact.company ?? "");
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [primary, setPrimary] = useState(contact.number);
  const [extras, setExtras] = useState<ContactNumber[]>(contact.extraNumbers ?? []);
  const [error, setError] = useState<string | null>(null);

  const numbers = allNumbers(contact);

  function startEditing() {
    setName(contact.name);
    setCompany(contact.company ?? "");
    setNotes(contact.notes ?? "");
    setPrimary(contact.number);
    setExtras(contact.extraNumbers ?? []);
    setError(null);
    setEditing(true);
  }

  function save() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a name.");
      return;
    }
    const normalizedPrimary = normalizePhoneNumber(primary);
    if (!isValidE164(normalizedPrimary)) {
      setError("The main number needs to be in international format, e.g. +12065551234");
      return;
    }
    // A half-typed extra number is dropped rather than refused: the row is
    // optional, and failing the whole save over a blank one is worse than
    // quietly leaving it out.
    const cleanedExtras: ContactNumber[] = [];
    for (const entry of extras) {
      const normalized = normalizePhoneNumber(entry.number);
      if (!entry.number.trim()) continue;
      if (!isValidE164(normalized)) {
        setError(`"${entry.number}" is not a valid number. Use international format, e.g. +12065551234`);
        return;
      }
      cleanedExtras.push({ label: entry.label || "Other", number: normalized });
    }

    onSave({
      ...contact,
      name: trimmedName,
      number: normalizedPrimary,
      ...(cleanedExtras.length ? { extraNumbers: cleanedExtras } : { extraNumbers: undefined }),
      ...(notes.trim() ? { notes: notes.trim() } : { notes: undefined }),
      ...(company.trim() ? { company: company.trim() } : { company: undefined }),
    });
    setEditing(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-gradient-to-br from-[#F7F2F1] via-white to-[#F5EFEE] animate-[chat-in_0.22s_ease-out] dark:from-[#0c0d10] dark:via-[#120a0b] dark:to-black">
      <header className="flex shrink-0 items-center gap-1 border-b border-slate-900/5 px-2 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-white/5">
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-all active:scale-90 active:bg-slate-900/5 dark:text-slate-300 dark:active:bg-white/10"
          aria-label="Back"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <p className="min-w-0 flex-1 truncate pl-1 text-base font-semibold text-slate-900 dark:text-white">
          {editing ? "Edit contact" : "Contact"}
        </p>
        {!editing && (
          <>
            <button
              type="button"
              onClick={startEditing}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-all active:scale-90 active:bg-slate-900/5 dark:text-slate-300 dark:active:bg-white/10"
              aria-label="Edit contact"
            >
              <PencilIcon className="h-4.5 w-4.5" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(contact)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#C0272D] transition-all active:scale-90 active:bg-slate-900/5 dark:text-[#ff6b72] dark:active:bg-white/10"
              aria-label="Delete contact"
            >
              <TrashIcon className="h-4.5 w-4.5" />
            </button>
          </>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5">
        <div className="flex flex-col items-center text-center">
          <Avatar label={name || contact.name} size="xl" />
          {editing ? (
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" className={`${FIELD_CLASS} mt-4 text-center text-lg font-semibold`} />
          ) : (
            <h2 className="mt-3 text-xl font-semibold tracking-wide text-slate-900 dark:text-white">{contact.name}</h2>
          )}
          {!editing && contact.company && (
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{contact.company}</p>
          )}
        </div>

        {!editing && (
          <div className="mt-6 flex gap-2">
            <button type="button" onClick={() => onCall(contact.number)} className={ACTION_CLASS}>
              <PhoneIcon className="h-5 w-5" />
              Call
            </button>
            <button type="button" onClick={() => onMessage(contact.number)} className={ACTION_CLASS}>
              <MessageIcon className="h-5 w-5" />
              Text
            </button>
          </div>
        )}

        {editing ? (
          <div className="mt-6 space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Main number</p>
              <input value={primary} onChange={(e) => setPrimary(e.target.value)} inputMode="tel" aria-label="Main number" className={FIELD_CLASS} />
            </div>

            {extras.map((entry, i) => (
              <div key={i} className="flex gap-2">
                <select
                  value={entry.label}
                  onChange={(e) => setExtras(extras.map((x, j) => (i === j ? { ...x, label: e.target.value } : x)))}
                  aria-label="Number label"
                  className={`${FIELD_CLASS} w-28 shrink-0`}
                >
                  {LABEL_OPTIONS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <input
                  value={entry.number}
                  onChange={(e) => setExtras(extras.map((x, j) => (i === j ? { ...x, number: e.target.value } : x)))}
                  inputMode="tel"
                  placeholder="+1 555 123 4567"
                  aria-label={`${entry.label} number`}
                  className={FIELD_CLASS}
                />
                <button
                  type="button"
                  onClick={() => setExtras(extras.filter((_, j) => j !== i))}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-slate-500 transition-all active:scale-90 dark:text-slate-400"
                  aria-label="Remove this number"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setExtras([...extras, { label: "Work", number: "" }])}
              className="flex items-center gap-1.5 rounded-full border border-white/60 bg-white/60 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-all active:scale-95 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add another number
            </button>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Company</p>
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional" aria-label="Company" className={FIELD_CLASS} />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Notes</p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Gate code, unit number, who referred them…"
                aria-label="Notes"
                className={`${FIELD_CLASS} resize-none`}
              />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                className="flex-1 rounded-full border border-slate-900/10 py-2.5 text-sm font-semibold text-slate-600 transition-all active:scale-[0.98] dark:border-white/10 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                className="flex-1 rounded-full bg-gradient-to-b from-[#e0555c] to-[#C0272D] py-2.5 text-sm font-semibold text-white transition-all active:scale-[0.98]"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-6 space-y-2">
              {numbers.map((entry, i) => (
                <div
                  key={`${entry.number}-${i}`}
                  className="flex items-center gap-3 rounded-2xl border border-white/60 bg-white/60 px-3.5 py-3 dark:border-white/10 dark:bg-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{entry.label}</p>
                    <p className="truncate text-[0.9375rem] tabular-nums text-slate-800 dark:text-slate-100">{entry.number}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCall(entry.number)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition-all active:scale-90 dark:text-slate-400"
                    aria-label={`Call ${entry.number}`}
                  >
                    <PhoneIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMessage(entry.number)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition-all active:scale-90 dark:text-slate-400"
                    aria-label={`Text ${entry.number}`}
                  >
                    <MessageIcon className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            {contact.notes && (
              <div className="mt-4 rounded-2xl border border-white/60 bg-white/60 px-3.5 py-3 dark:border-white/10 dark:bg-white/5">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">{contact.notes}</p>
              </div>
            )}

            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Recent calls</p>
              {calls.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">No calls with this person yet.</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {calls.slice(0, 15).map((entry) => (
                    <div
                      key={entry.sid}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/50 bg-white/50 px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]"
                    >
                      <p
                        className={`min-w-0 flex-1 truncate text-[0.8125rem] ${
                          isMissed(entry) ? "text-[#C0272D] dark:text-[#ff6b72]" : "text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {statusLabel(entry)}
                      </p>
                      <span className="shrink-0 text-[0.6875rem] text-slate-400 dark:text-slate-500">{relativeDay(entry.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
