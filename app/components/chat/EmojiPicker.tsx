"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PlusIcon, SearchIcon, TrashIcon } from "../icons";
import { STICKER_PACKS, deleteMySticker, loadMyStickers, photoToSticker, saveMySticker } from "@/lib/stickers";
import { EMOJI_CATEGORIES, loadRecentEmoji, rememberEmoji, searchEmoji } from "@/lib/emoji";


// WhatsApp style emoji panel. On a phone it sits in the space the keyboard
// would use; on a computer it floats above the message box. Search, a row of
// category tabs, and a "recent" strip.
export function EmojiPicker({
  onPick,
  onSticker,
  username,
  initialMode = "emoji",
  className = "",
  height = "16rem",
}: {
  onPick: (emoji: string) => void;
  /** Sends a sticker: a big emoji, or one of your own as a PNG picture. */
  onSticker?: (sticker: { emoji?: string; dataUrl?: string }) => void;
  username?: string;
  initialMode?: "emoji" | "stickers";
  className?: string;
  height?: string;
}) {
  const [mode, setMode] = useState<"emoji" | "stickers">(onSticker ? initialMode : "emoji");
  const [mine, setMine] = useState<string[]>([]);
  const [stickerError, setStickerError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [active, setActive] = useState<string>("smileys");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    // Recents live in localStorage, which the server render cannot see.
    const timer = setTimeout(() => {
      setRecent(loadRecentEmoji());
      if (username) setMine(loadMyStickers(username));
    }, 0);
    return () => clearTimeout(timer);
  }, [username]);

  const results = useMemo(() => searchEmoji(query), [query]);
  const searching = query.trim().length > 0;

  function pick(emoji: string) {
    setRecent(rememberEmoji(emoji));
    onPick(emoji);
  }

  function jumpTo(id: string) {
    setActive(id);
    const section = sectionRefs.current[id];
    const scroller = scrollRef.current;
    if (section && scroller) scroller.scrollTo({ top: section.offsetTop - 4 });
  }

  function onScroll() {
    const scroller = scrollRef.current;
    if (!scroller || searching) return;
    let current = EMOJI_CATEGORIES[0].id;
    for (const c of EMOJI_CATEGORIES) {
      const el = sectionRefs.current[c.id];
      if (el && el.offsetTop - 12 <= scroller.scrollTop) current = c.id;
    }
    setActive(current);
  }

  const cell =
    "flex h-10 w-10 items-center justify-center rounded-xl text-[1.65rem] leading-none transition-transform hover:bg-slate-900/5 active:scale-125 dark:hover:bg-white/10";

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-3xl border border-white/70 bg-white/95 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.35)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#17181c]/95 ${className}`}
      style={{ height }}
      role="group"
      aria-label="Emoji"
      // Keeps the message box focused (and the phone keyboard from flickering)
      // while tapping an emoji.
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault();
      }}
    >
      {onSticker && (
        <div className="flex shrink-0 gap-1 px-3 pt-3" role="tablist" aria-label="Emoji or stickers">
          {(["emoji", "stickers"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-full py-1.5 text-xs font-semibold capitalize transition-all ${mode === m ? "bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white" : "bg-slate-900/5 text-slate-600 dark:bg-white/10 dark:text-slate-300"}`}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {mode === "stickers" && onSticker ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-2" data-testid="sticker-panel">
          <p className="pb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">My stickers</p>
          <div className="grid grid-cols-5 gap-1.5">
            <label className="flex aspect-square cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 text-slate-500 hover:bg-slate-900/5 dark:border-white/20 dark:text-slate-300" aria-label="Make a sticker from a photo">
              <PlusIcon className="h-6 w-6" />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file || !username) return;
                  setStickerError(null);
                  try {
                    const dataUrl = await photoToSticker(file);
                    const res = saveMySticker(username, dataUrl);
                    setMine(res.list);
                    if (!res.saved) setStickerError("Your browser has no room to keep it, but you can still send it now.");
                  } catch (err) {
                    setStickerError(err instanceof Error ? err.message : "Could not make the sticker.");
                  }
                }}
              />
            </label>
            {mine.map((src, i) => (
              <div key={i} className="group relative aspect-square">
                <button type="button" onClick={() => onSticker({ dataUrl: src })} className="h-full w-full rounded-2xl bg-slate-900/[0.04] p-1 active:scale-95 dark:bg-white/[0.06]" aria-label={`Send my sticker ${i + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-full w-full object-contain" />
                </button>
                <button
                  type="button"
                  onClick={() => username && setMine(deleteMySticker(username, src))}
                  className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/70 text-white opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                  aria-label={`Delete my sticker ${i + 1}`}
                >
                  <TrashIcon className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          {stickerError && <p className="pt-1 text-xs text-red-600 dark:text-red-400">{stickerError}</p>}
          {STICKER_PACKS.map((pack) => (
            <section key={pack.id} aria-label={pack.label}>
              <p className="pb-1 pt-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">{pack.label}</p>
              <div className="grid grid-cols-5 gap-1.5">
                {pack.items.map((emoji) => (
                  <button key={emoji} type="button" onClick={() => onSticker({ emoji })} className="flex aspect-square items-center justify-center rounded-2xl bg-slate-900/[0.04] text-[2.25rem] leading-none transition-transform hover:bg-slate-900/[0.08] active:scale-90 dark:bg-white/[0.06]" aria-label={`Send ${emoji} sticker`}>
                    {emoji}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
      <>
      <div className="relative shrink-0 px-3 pt-3">
        <SearchIcon className="pointer-events-none absolute left-6 top-1/2 mt-1.5 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji"
          aria-label="Search emoji"
          className="block w-full rounded-full border border-slate-900/10 bg-slate-900/5 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#C0272D]/40 dark:border-white/10 dark:bg-white/10 dark:text-slate-50"
        />
      </div>

      {!searching && (
        <div className="flex shrink-0 items-center justify-between gap-1 px-3 pb-1 pt-2" role="tablist" aria-label="Emoji categories">
          {EMOJI_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={active === c.id}
              aria-label={c.label}
              onClick={() => jumpTo(c.id)}
              className={`flex h-8 min-w-0 flex-1 items-center justify-center rounded-full text-lg transition-all active:scale-90 ${
                active === c.id ? "bg-[#C0272D]/12 shadow-[inset_0_-2px_0_#C0272D]" : "opacity-70 hover:opacity-100"
              }`}
            >
              {c.icon}
            </button>
          ))}
        </div>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {searching ? (
          results.length ? (
            <div className="flex flex-wrap pt-2">
              {results.map((e) => (
                <button key={e.emoji} type="button" className={cell} onClick={() => pick(e.emoji)} aria-label={e.keywords.split(" ")[0] || e.emoji}>
                  {e.emoji}
                </button>
              ))}
            </div>
          ) : (
            <p className="pt-8 text-center text-sm text-slate-400">No emoji found</p>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <section aria-label="Recently used">
                <p className="px-1.5 pb-0.5 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">Recent</p>
                <div className="flex flex-wrap">
                  {recent.map((emoji) => (
                    <button key={emoji} type="button" className={cell} onClick={() => pick(emoji)} aria-label={`Recent ${emoji}`}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {EMOJI_CATEGORIES.map((c) => (
              <section key={c.id} ref={(el) => { sectionRefs.current[c.id] = el; }} aria-label={c.label}>
                <p className="px-1.5 pb-0.5 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-400">{c.label}</p>
                <div className="flex flex-wrap">
                  {c.items.map((e) => (
                    <button key={e.emoji + e.keywords} type="button" className={cell} onClick={() => pick(e.emoji)} aria-label={e.keywords.split(" ")[0] || e.emoji}>
                      {e.emoji}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
      </>
      )}
    </div>
  );
}
