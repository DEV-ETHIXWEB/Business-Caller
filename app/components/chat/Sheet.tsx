"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "../icons";

// The shell every small dialog shares: a bottom sheet on a phone, a centred
// card on a computer. Portalled to the page root so the blurred panels around
// the chat cannot trap it, and closable with Escape or a tap outside.
export function Sheet({
  title,
  onClose,
  children,
  footer,
  z = 65,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  z?: number;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 flex items-end justify-center bg-black/40 backdrop-blur-sm animate-[fade-in_0.15s_ease-out] lg:items-center lg:p-6"
      style={{ zIndex: z }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/70 bg-white shadow-[0_-20px_50px_-15px_rgba(15,23,42,0.4)] animate-[slide-fade-in_0.2s_ease-out] dark:border-white/10 dark:bg-[#17181c] lg:max-w-md lg:rounded-3xl"
      >
        <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/10"
            aria-label="Close"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-slate-900/5 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 dark:border-white/5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export const FIELD_CLASS =
  "block w-full rounded-xl border border-slate-900/10 bg-white px-3 py-2.5 text-base text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#C0272D]/40 focus:ring-4 focus:ring-[#C0272D]/10 dark:border-white/10 dark:bg-white/5 dark:text-slate-50";

export const PRIMARY_CLASS =
  "w-full rounded-full bg-gradient-to-b from-[#e0555c] to-[#C0272D] py-3 text-sm font-semibold text-white shadow-[0_10px_22px_-10px_rgba(192,39,45,0.7)] transition-all active:scale-[0.98] disabled:opacity-40 disabled:shadow-none";
