"use client";

import { useState } from "react";
import { Avatar } from "../Avatar";
import { SearchIcon } from "../icons";
import { FIELD_CLASS, PRIMARY_CLASS, Sheet } from "./Sheet";

export interface Person {
  number: string;
  name?: string;
}

// Pick one person (share a contact, forward) or several (a broadcast list).
export function PersonPicker({
  title,
  people,
  multiple = false,
  confirmLabel = "Done",
  initial = [],
  exclude = [],
  onPick,
  onClose,
}: {
  title: string;
  people: Person[];
  multiple?: boolean;
  confirmLabel?: string;
  initial?: string[];
  exclude?: string[];
  onPick: (numbers: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>(initial);
  const q = query.trim().toLowerCase();
  const list = people
    .filter((p) => !exclude.includes(p.number))
    .filter((p) => !q || (p.name ?? "").toLowerCase().includes(q) || p.number.includes(q));

  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        multiple ? (
          <button type="button" disabled={!picked.length} onClick={() => { onPick(picked); onClose(); }} className={PRIMARY_CLASS}>
            {confirmLabel} {picked.length ? `(${picked.length})` : ""}
          </button>
        ) : undefined
      }
    >
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people" aria-label="Search people" className={`${FIELD_CLASS} pl-9`} />
      </div>
      <div className="mt-2 space-y-0.5" role="list">
        {list.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No one found.</p>}
        {list.map((p) => {
          const on = picked.includes(p.number);
          return (
            <button
              key={p.number}
              type="button"
              role={multiple ? "checkbox" : "listitem"}
              aria-checked={multiple ? on : undefined}
              onClick={() => {
                if (!multiple) {
                  onPick([p.number]);
                  onClose();
                } else setPicked((cur) => (cur.includes(p.number) ? cur.filter((n) => n !== p.number) : [...cur, p.number]));
              }}
              className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-slate-900/5 dark:hover:bg-white/10"
            >
              <Avatar label={p.name ?? p.number} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem] font-semibold text-slate-800 dark:text-slate-100">{p.name ?? p.number}</span>
                {p.name && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{p.number}</span>}
              </span>
              {multiple && (
                <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${on ? "border-[#C0272D] bg-[#C0272D] text-white" : "border-slate-300 dark:border-white/20"}`} aria-hidden>
                  {on && "✓"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
