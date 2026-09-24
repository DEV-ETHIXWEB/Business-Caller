"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { StarredRecord } from "@/lib/chatPrefs";
import { ArrowLeftIcon, StarIcon } from "../icons";
import { Avatar } from "../Avatar";

// Every message you have starred, across all chats, newest first. Tap one to
// open its chat and jump to it.
export function StarredView({
  starred,
  nameFor,
  onOpen,
  onUnstar,
  onClose,
}: {
  starred: Record<string, StarredRecord>;
  nameFor: (number: string) => string | undefined;
  onOpen: (number: string, sid: string) => void;
  onUnstar: (sid: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items = Object.entries(starred).sort((a, b) => b[1].at - a[1].at);

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-stretch justify-center bg-black/40 backdrop-blur-sm animate-[fade-in_0.2s_ease-out] lg:items-center lg:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Starred messages"
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col overflow-hidden bg-gradient-to-br from-[#F7F2F1] via-white to-[#F5EFEE] animate-[chat-in_0.22s_ease-out] dark:from-[#0c0d10] dark:via-[#120a0b] dark:to-black lg:h-[min(40rem,calc(100dvh-3rem))] lg:max-w-md lg:rounded-[2rem] lg:border lg:border-white/70 dark:lg:border-white/10"
      >
        <header className="flex shrink-0 items-center gap-1 border-b border-slate-900/5 px-2 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-white/5 lg:pt-4">
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 active:scale-90 dark:text-slate-300" aria-label="Close starred messages">
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <h2 className="text-xl font-semibold tracking-wide text-slate-900 dark:text-white">Starred messages</h2>
        </header>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-3">
          {items.length === 0 && (
            <div className="flex flex-col items-center px-6 pt-16 text-center text-slate-500 dark:text-slate-400">
              <StarIcon className="h-10 w-10 opacity-40" />
              <p className="mt-3 text-sm">No starred messages yet. Select a message and tap the star to keep it here.</p>
            </div>
          )}
          {items.map(([sid, r]) => {
            const name = nameFor(r.number);
            return (
              <div key={sid} className="flex items-center gap-3 rounded-2xl border border-white/60 bg-white/60 px-3 py-2.5 dark:border-white/5 dark:bg-white/[0.04]">
                <button type="button" onClick={() => onOpen(r.number, sid)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Open starred message from ${name ?? r.number}`}>
                  <Avatar label={name ?? r.number} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[0.9375rem] font-semibold text-slate-800 dark:text-slate-100">{r.direction === "outbound" ? `You to ${name ?? r.number}` : (name ?? r.number)}</span>
                      <span className="shrink-0 text-[0.6875rem] text-slate-500 dark:text-slate-400">{new Date(r.at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[0.8125rem] text-slate-600 [overflow-wrap:anywhere] dark:text-slate-300">{r.body}</span>
                  </span>
                </button>
                <button type="button" onClick={() => onUnstar(sid)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-amber-500 active:scale-90" aria-label="Remove from starred">
                  <StarIcon filled className="h-5 w-5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
