"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "../Avatar";
import { ArchiveIcon, ArrowLeftIcon, BanIcon, BellIcon, BellOffIcon, DownloadIcon, FileIcon, MusicIcon, PhoneIcon, SearchIcon, ShareIcon, TagIcon, TimerIcon, TrashIcon, VideoIcon } from "../icons";
import { Segmented, Toggle } from "../SettingsPanel";
import type { ChatPrefsApi } from "@/lib/chatPrefs";
import type { ThreadMessage } from "@/lib/messageThread";

const LINK_RE = /https?:\/\/[^\s]+/g;

interface LinkItem {
  url: string;
  sid: string;
  at: number;
}

const DISAPPEAR: { label: string; seconds: number }[] = [
  { label: "Off", seconds: 0 },
  { label: "24 hours", seconds: 24 * 3600 },
  { label: "7 days", seconds: 7 * 24 * 3600 },
  { label: "90 days", seconds: 90 * 24 * 3600 },
];

const rowClass =
  "flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left text-[0.9375rem] font-medium transition-colors hover:bg-slate-900/5 dark:hover:bg-white/10";

// Everything about one chat in one place, like WhatsApp's "Contact info":
// shared media, documents and links, and each per-chat setting.
export function ChatInfo({
  number,
  name,
  isDesktop,
  prefs,
  messages,
  onClose,
  onCall,
  onSearch,
  onJump,
  onExport,
  onCopyLink,
  onClearChat,
  onDeleteChat,
  onMute,
  lockAvailable,
  onToggleLock,
}: {
  number: string;
  name?: string;
  isDesktop: boolean;
  prefs: ChatPrefsApi;
  messages: ThreadMessage[];
  onClose: () => void;
  onCall: () => void;
  onSearch: () => void;
  onJump: (sid: string) => void;
  onExport: () => void;
  onCopyLink: () => void;
  onClearChat: () => void;
  onDeleteChat: () => void;
  onMute: () => void;
  /** Whether a PIN is set up, so chat lock has a way back in. */
  lockAvailable: boolean;
  onToggleLock: () => void;
}) {
  const [tab, setTab] = useState<"media" | "docs" | "links">("media");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { media, docs, links } = useMemo(() => {
    const m: { sid: string; url: string; kind: string; at: number }[] = [];
    const d: { sid: string; kind: string; label: string; at: number }[] = [];
    const l: LinkItem[] = [];
    for (const msg of messages) {
      for (const a of msg.media ?? []) {
        if (a.kind === "image" || a.kind === "video") m.push({ sid: msg.sid, url: a.url, kind: a.kind, at: msg.at });
        else d.push({ sid: msg.sid, kind: a.kind, label: a.kind === "audio" ? "Voice or audio" : /pdf/i.test(a.contentType) ? "PDF document" : "Attachment", at: msg.at });
      }
      for (const url of msg.body.match(LINK_RE) ?? []) l.push({ url: url.replace(/[.,!?;:)\]]+$/, ""), sid: msg.sid, at: msg.at });
    }
    return { media: m.reverse(), docs: d.reverse(), links: l.reverse() };
  }, [messages]);

  const muted = prefs.isMuted(number);
  const wallpaper = prefs.prefs.chatWallpaper[number] ?? "default";
  const disappearing = prefs.prefs.disappearing[number] ?? 0;
  const tabBtn = (id: typeof tab, label: string, n: number) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`flex-1 rounded-full py-1.5 text-xs font-semibold transition-all ${tab === id ? "bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white" : "bg-slate-900/5 text-slate-600 dark:bg-white/10 dark:text-slate-300"}`}
    >
      {label} {n}
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-[58] flex justify-end bg-black/30 backdrop-blur-[2px] animate-[fade-in_0.15s_ease-out]" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Contact info"
        onClick={(e) => e.stopPropagation()}
        className={`flex h-full w-full flex-col overflow-hidden bg-gradient-to-br from-[#F7F2F1] via-white to-[#F5EFEE] dark:from-[#0c0d10] dark:via-[#120a0b] dark:to-black ${isDesktop ? "max-w-[26rem] border-l border-white/60 shadow-[-20px_0_50px_-20px_rgba(15,23,42,0.4)] animate-[chat-in_0.22s_ease-out] dark:border-white/10" : "animate-[chat-in_0.22s_ease-out]"}`}
      >
        <header className="flex shrink-0 items-center gap-1 border-b border-slate-900/5 px-2 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-white/5">
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 active:scale-90 dark:text-slate-300" aria-label="Close contact info">
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Contact info</h2>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
          <div className="flex flex-col items-center text-center">
            <Avatar label={name ?? number} size="xl" />
            <p className="mt-3 text-xl font-semibold text-slate-900 dark:text-white">{name ?? number}</p>
            {name && <p className="text-sm text-slate-500 dark:text-slate-400">{number}</p>}
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={onCall} className="flex w-20 flex-col items-center gap-1.5 rounded-2xl bg-white/70 py-3 text-xs font-semibold text-slate-700 shadow-sm active:scale-95 dark:bg-white/[0.06] dark:text-slate-200">
                <PhoneIcon className="h-5 w-5 text-[#C0272D] dark:text-[#ff6b72]" /> Call
              </button>
              <button type="button" onClick={onSearch} className="flex w-20 flex-col items-center gap-1.5 rounded-2xl bg-white/70 py-3 text-xs font-semibold text-slate-700 shadow-sm active:scale-95 dark:bg-white/[0.06] dark:text-slate-200">
                <SearchIcon className="h-5 w-5 text-[#C0272D] dark:text-[#ff6b72]" /> Search
              </button>
            </div>
          </div>

          <section className="mt-6" aria-label="Shared media, documents and links">
            <div className="flex gap-1.5" role="tablist" aria-label="Shared">
              {tabBtn("media", "Media", media.length)}
              {tabBtn("docs", "Docs", docs.length)}
              {tabBtn("links", "Links", links.length)}
            </div>
            <div className="mt-3" data-testid={`shared-${tab}`}>
              {tab === "media" &&
                (media.length ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {media.map((m, i) => (
                      <button key={m.sid + i} type="button" onClick={() => { onJump(m.sid); onClose(); }} className="relative aspect-square overflow-hidden rounded-xl bg-slate-900/10 active:scale-95" aria-label={`Open ${m.kind} from ${new Date(m.at).toLocaleDateString()}`}>
                        {m.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-slate-600 dark:text-slate-300">
                            <VideoIcon className="h-7 w-7" />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No photos or videos in this chat yet.</p>
                ))}
              {tab === "docs" &&
                (docs.length ? (
                  <ul className="space-y-1">
                    {docs.map((d, i) => (
                      <li key={d.sid + i}>
                        <button type="button" onClick={() => { onJump(d.sid); onClose(); }} className={rowClass + " text-slate-800 dark:text-slate-100"}>
                          {d.kind === "audio" ? <MusicIcon className="h-5 w-5 shrink-0" /> : <FileIcon className="h-5 w-5 shrink-0" />}
                          <span className="min-w-0 flex-1 truncate">{d.label}</span>
                          <span className="shrink-0 text-xs font-normal text-slate-500 dark:text-slate-400">{new Date(d.at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No documents or voice messages yet.</p>
                ))}
              {tab === "links" &&
                (links.length ? (
                  <ul className="space-y-1">
                    {links.map((l, i) => (
                      <li key={l.sid + i}>
                        <a href={l.url} target="_blank" rel="noopener noreferrer" className={rowClass + " text-slate-800 dark:text-slate-100"}>
                          <DownloadIcon className="h-5 w-5 shrink-0 -rotate-90" />
                          <span className="min-w-0 flex-1 truncate">{l.url.replace(/^https?:\/\//, "")}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No links shared yet.</p>
                ))}
            </div>
          </section>

          <section className="mt-6 rounded-3xl border border-white/70 bg-white/70 px-4 py-2 dark:border-white/10 dark:bg-white/[0.04]" aria-label="Chat settings">
            <button type="button" onClick={muted ? () => prefs.mute(number, 0) : onMute} className={rowClass.replace("px-2", "px-0") + " text-slate-800 dark:text-slate-100"} aria-label={muted ? "Unmute notifications" : "Mute notifications"}>
              {muted ? <BellIcon className="h-5 w-5" /> : <BellOffIcon className="h-5 w-5" />}
              <span className="flex-1">{muted ? "Unmute notifications" : "Mute notifications"}</span>
              {muted && <span className="text-xs font-normal text-slate-500 dark:text-slate-400">Muted</span>}
            </button>
            <div className="divide-y divide-slate-900/5 dark:divide-white/5">
              <Toggle label="Favourite" checked={prefs.isFavorite(number)} onChange={() => prefs.toggleFavorite(number)} />
              <Toggle label="Archive chat" hint="Keeps it out of your main list." checked={prefs.isArchived(number)} onChange={() => prefs.toggleArchive(number)} />
              <Toggle
                label="Lock chat"
                hint={lockAvailable ? "Hides it behind your PIN." : "Set up a PIN in Settings first."}
                checked={prefs.isLocked(number)}
                onChange={onToggleLock}
              />
            </div>

            <div className="border-t border-slate-900/5 py-3 dark:border-white/5">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                <TimerIcon className="h-4 w-4" /> Disappearing messages
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Older texts are deleted from Twilio&apos;s records the next time this chat is open.</p>
              <div className="mt-2">
                <Segmented
                  label="Disappearing messages"
                  value={String(disappearing)}
                  options={DISAPPEAR.map((d) => ({ value: String(d.seconds), label: d.label }))}
                  onChange={(v) => prefs.setDisappearing(number, Number(v))}
                />
              </div>
            </div>

            <div className="border-t border-slate-900/5 py-3 dark:border-white/5">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Chat wallpaper</p>
              <div className="mt-2">
                <Segmented
                  label="Chat wallpaper"
                  value={wallpaper}
                  options={[
                    { value: "default", label: "Default" },
                    { value: "dots", label: "Dots" },
                    { value: "blush", label: "Blush" },
                    { value: "plain", label: "Plain" },
                  ]}
                  onChange={(v) => prefs.setChatWallpaper(number, v === "default" ? null : v)}
                />
              </div>
            </div>

            <div className="border-t border-slate-900/5 py-3 dark:border-white/5">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
                <TagIcon className="h-4 w-4" /> Labels
              </p>
              {prefs.prefs.labelDefs.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">No labels yet. Make one from a chat&apos;s menu in the list.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {prefs.prefs.labelDefs.map((l) => {
                    const on = (prefs.prefs.chatLabels[number] ?? []).includes(l.id);
                    return (
                      <button key={l.id} type="button" aria-pressed={on} onClick={() => prefs.toggleChatLabel(number, l.id)} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all active:scale-95 ${on ? "border-transparent text-white" : "border-slate-900/10 text-slate-600 dark:border-white/10 dark:text-slate-300"}`} style={on ? { background: l.color } : undefined}>
                        <span className="h-2 w-2 rounded-full" style={{ background: on ? "#fff" : l.color }} aria-hidden />
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="mt-4 rounded-3xl border border-white/70 bg-white/70 px-4 py-1 dark:border-white/10 dark:bg-white/[0.04]" aria-label="Chat actions">
            <button type="button" onClick={onExport} className={rowClass + " text-slate-800 dark:text-slate-100"}>
              <DownloadIcon className="h-5 w-5" /> Export chat
            </button>
            <button type="button" onClick={onCopyLink} className={rowClass + " text-slate-800 dark:text-slate-100"}>
              <ShareIcon className="h-5 w-5" /> Copy chat link
            </button>
            <button type="button" onClick={() => prefs.toggleBlock(number)} className={rowClass + " text-[#C0272D] dark:text-[#ff6b72]"}>
              <BanIcon className="h-5 w-5" /> {prefs.isBlocked(number) ? "Unblock" : "Block"} {name ?? number}
            </button>
            <button type="button" onClick={onClearChat} className={rowClass + " text-[#C0272D] dark:text-[#ff6b72]"}>
              <ArchiveIcon className="h-5 w-5" /> Clear chat
            </button>
            <button type="button" onClick={onDeleteChat} className={rowClass + " text-[#C0272D] dark:text-[#ff6b72]"}>
              <TrashIcon className="h-5 w-5" /> Delete chat
            </button>
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
