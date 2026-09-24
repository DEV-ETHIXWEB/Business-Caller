"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

export interface ConfirmOption {
  label: string;
  detail?: string;
  danger?: boolean;
  run: () => void;
}

// A bottom sheet on phones, a small dialog on a computer, for decisions that
// need more than OK / Cancel (like "delete for me" versus "delete permanently").
export function ConfirmSheet({ title, body, options, onClose }: { title: string; body?: string; options: ConfirmOption[]; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/40 backdrop-blur-sm animate-[fade-in_0.15s_ease-out] lg:items-center lg:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-3xl border border-white/70 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-20px_50px_-15px_rgba(15,23,42,0.4)] animate-[slide-fade-in_0.2s_ease-out] dark:border-white/10 dark:bg-[#17181c] lg:max-w-sm lg:rounded-3xl lg:pb-4"
      >
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
        {body && <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{body}</p>}
        <div className="mt-3 space-y-1.5">
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => {
                onClose();
                o.run();
              }}
              className={`block w-full rounded-2xl px-4 py-3 text-left transition-colors hover:bg-slate-900/5 active:scale-[0.99] dark:hover:bg-white/10 ${
                o.danger ? "text-[#C0272D] dark:text-[#ff6b72]" : "text-slate-800 dark:text-slate-100"
              }`}
            >
              <span className="block text-[0.9375rem] font-semibold">{o.label}</span>
              {o.detail && <span className="mt-0.5 block text-xs font-normal text-slate-500 dark:text-slate-400">{o.detail}</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={onClose}
            className="block w-full rounded-2xl bg-slate-900/5 px-4 py-3 text-center text-[0.9375rem] font-semibold text-slate-700 active:scale-[0.99] dark:bg-white/10 dark:text-slate-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
