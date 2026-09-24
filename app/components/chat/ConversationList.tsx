"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "../Avatar";
import { CameraIcon, DotsIcon, MailIcon, MicIcon, PaperclipIcon, PinIcon, TrashIcon } from "../icons";
import type { ChatPrefsApi } from "@/lib/chatPrefs";
import type { ConversationSummary } from "@/lib/messageThread";


export type ListFilter = "all" | "unread" | "pinned";

function relativeDay(at: number): string {
  const date = new Date(at);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

interface MenuState {
  number: string;
  x: number;
  y: number;
}

function Preview({ c, draft, unread }: { c: ConversationSummary; draft?: string; unread: boolean }) {
  const tone = unread ? "text-slate-700 dark:text-slate-200" : "text-slate-500 dark:text-slate-400";
  if (draft) {
    return (
      <p className={`mt-0.5 truncate text-[0.8125rem] ${tone}`}>
        <span className="font-medium text-[#C0272D] dark:text-[#ff6b72]">Draft: </span>
        {draft}
      </p>
    );
  }
  const you = c.lastDirection === "outbound" ? <span className="text-slate-400 dark:text-slate-500">You: </span> : null;
  if (c.lastKind) {
    const label = { audio: "Voice message", image: "Photo", video: "Video", other: "Attachment" }[c.lastKind];
    const Icon = c.lastKind === "audio" ? MicIcon : c.lastKind === "other" ? PaperclipIcon : CameraIcon;
    return (
      <p className={`mt-0.5 flex items-center gap-1 truncate text-[0.8125rem] ${tone}`}>
        {you}
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{c.lastBody || label}</span>
      </p>
    );
  }
  return (
    <p className={`mt-0.5 truncate text-[0.8125rem] ${tone}`}>
      {you}
      {c.lastBody || "Message"}
    </p>
  );
}

// The Texts inbox: filter chips and the rows, WhatsApp style. Each row can be
// pinned, marked unread, or deleted from a menu (long press on a phone, right
// click or the dots on a computer).
export function ConversationList({
  conversations,
  nameFor,
  loading,
  search,
  activeNumber,
  prefs,
  isDesktop,
  onOpen,
  onDelete,
}: {
  conversations: ConversationSummary[];
  nameFor: (number: string) => string | undefined;
  loading: boolean;
  search: string;
  activeNumber: string | null;
  prefs: ChatPrefsApi;
  isDesktop: boolean;
  onOpen: (number: string) => void;
  onDelete: (number: string) => void;
}) {
  const [filter, setFilter] = useState<ListFilter>("all");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const pressRef = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);

  const q = search.trim().toLowerCase();
  const matches = conversations.filter((c) => {
    if (!q) return true;
    return (nameFor(c.number) ?? "").toLowerCase().includes(q) || c.number.includes(q) || c.lastBody.toLowerCase().includes(q);
  });
  const unreadCount = conversations.filter((c) => prefs.isUnread(c)).length;
  const pinnedCount = conversations.filter((c) => prefs.isPinned(c.number)).length;
  const visible = matches
    .filter((c) => (filter === "unread" ? prefs.isUnread(c) : filter === "pinned" ? prefs.isPinned(c.number) : true))
    .sort((a, b) => Number(prefs.isPinned(b.number)) - Number(prefs.isPinned(a.number)) || b.lastAt - a.lastAt);

  // Close the menu on Escape or when the list changes under it.
  useEffect(() => {
    if (!menu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  function openMenu(number: string, x: number, y: number) {
    setMenu({ number, x, y });
  }

  const chip = (id: ListFilter, label: string, count?: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      aria-pressed={filter === id}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
        filter === id
          ? "bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white shadow-[0_6px_14px_-6px_rgba(192,39,45,0.7)]"
          : "border border-slate-900/10 bg-white/60 text-slate-600 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
      }`}
    >
      {label}
      {count ? <span className="ml-1 opacity-80">{count}</span> : null}
    </button>
  );

  const menuTarget = menu ? conversations.find((c) => c.number === menu.number) : undefined;
  const menuName = menu ? (nameFor(menu.number) ?? menu.number) : "";

  return (
    <>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5" role="group" aria-label="Filter chats">
        {chip("all", "All")}
        {chip("unread", "Unread", unreadCount)}
        {chip("pinned", "Pinned", pinnedCount)}
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto pb-24 lg:pb-4" role="list" aria-label="Conversations">
        {loading && conversations.length === 0 && <p className="p-4 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</p>}
        {!loading && visible.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">
            {conversations.length === 0
              ? "No conversations yet."
              : filter === "unread" && !q
                ? "No unread chats."
                : filter === "pinned" && !q
                  ? "No pinned chats. Long press or right click a chat to pin it."
                  : "No conversations match your search."}
          </p>
        )}
        {visible.map((c) => {
          const name = nameFor(c.number);
          const unread = prefs.isUnread(c);
          const pinned = prefs.isPinned(c.number);
          const active = activeNumber === c.number;
          const draft = prefs.prefs.drafts[c.number];
          return (
            <div
              key={c.number}
              role="listitem"
              className={`group relative flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all active:scale-[0.99] ${
                active
                  ? "border-[#C0272D]/25 bg-[#C0272D]/[0.07] dark:border-[#C0272D]/30 dark:bg-[#C0272D]/[0.14]"
                  : "border-white/50 bg-white/40 hover:bg-white/70 dark:border-white/5 dark:bg-white/[0.03] dark:hover:bg-white/[0.08]"
              }`}
              onContextMenu={(e) => {
                e.preventDefault();
                openMenu(c.number, e.clientX, e.clientY);
              }}
            >
              <button
                type="button"
                onPointerDown={(e) => {
                  if (e.pointerType === "mouse") return;
                  const state = { timer: 0, x: e.clientX, y: e.clientY, fired: false };
                  state.timer = window.setTimeout(() => {
                    state.fired = true;
                    if ("vibrate" in navigator) navigator.vibrate?.(10);
                    openMenu(c.number, state.x, state.y);
                  }, 480);
                  pressRef.current = state;
                }}
                onPointerMove={(e) => {
                  const s = pressRef.current;
                  if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) window.clearTimeout(s.timer);
                }}
                onPointerUp={() => pressRef.current && window.clearTimeout(pressRef.current.timer)}
                onPointerCancel={() => pressRef.current && window.clearTimeout(pressRef.current.timer)}
                onClick={() => {
                  // A long press already opened the menu: do not also open the chat.
                  if (pressRef.current?.fired) {
                    pressRef.current = null;
                    return;
                  }
                  onOpen(c.number);
                }}
                className="flex min-w-0 flex-1 select-none items-center gap-3 text-left [-webkit-touch-callout:none]"
              >
                <Avatar label={name ?? c.number} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-[0.9375rem] text-slate-800 dark:text-slate-100 ${unread ? "font-bold" : "font-semibold"}`}>{name ?? c.number}</p>
                  <Preview c={c} draft={draft && !active ? draft : undefined} unread={unread} />
                </div>
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1.5 self-stretch py-0.5">
                <span className={`text-[0.6875rem] ${unread ? "font-semibold text-[#C0272D] dark:text-[#ff6b72]" : "text-slate-500 dark:text-slate-400"}`}>{relativeDay(c.lastAt)}</span>
                <div className="flex items-center gap-1.5">
                  {pinned && <PinIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" aria-hidden />}
                  {unread && <span className="h-2.5 w-2.5 rounded-full bg-[#C0272D] shadow-[0_0_0_3px_rgba(192,39,45,0.18)]" role="img" aria-label="Unread" />}
                  <button
                    type="button"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      openMenu(c.number, r.right, r.bottom);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-all lg:h-6 lg:w-6 dark:text-slate-400 hover:bg-slate-900/5 hover:text-slate-600 active:scale-90 focus-visible:opacity-100 dark:hover:bg-white/10 lg:opacity-0 lg:group-hover:opacity-100"
                    aria-label={`More options for ${name ?? c.number}`}
                    aria-haspopup="menu"
                  >
                    <DotsIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Portalled to the page root: the glass panel around the list blurs its
          background, which would otherwise trap a fixed menu inside it and
          leave it hidden behind the tab bar. */}
      {menu && menuTarget && createPortal(
        <div className={`fixed inset-0 z-50 ${isDesktop ? "" : "bg-black/30 animate-[fade-in_0.15s_ease-out]"}`} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div
            role="menu"
            aria-label={`Options for ${menuName}`}
            onClick={(e) => e.stopPropagation()}
            className={
              isDesktop
                ? "absolute w-56 overflow-hidden rounded-2xl border border-white/70 bg-white/95 p-1.5 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.4)] backdrop-blur-2xl animate-[pop-in_0.15s_ease-out] dark:border-white/10 dark:bg-[#17181c]/95"
                : "absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-white/70 bg-white p-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-20px_50px_-15px_rgba(15,23,42,0.4)] animate-[slide-fade-in_0.2s_ease-out] dark:border-white/10 dark:bg-[#17181c]"
            }
            style={isDesktop ? { left: Math.min(menu.x, window.innerWidth - 232), top: Math.min(menu.y, window.innerHeight - 190) } : undefined}
          >
            {!isDesktop && <p className="px-2 pb-2 pt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{menuName}</p>}
            {[
              {
                key: "pin",
                label: prefs.isPinned(menu.number) ? "Unpin chat" : "Pin chat",
                icon: <PinIcon className="h-[1.125rem] w-[1.125rem]" />,
                run: () => prefs.togglePin(menu.number),
                danger: false,
              },
              {
                key: "unread",
                label: prefs.isUnread(menuTarget) ? "Mark as read" : "Mark as unread",
                icon: <MailIcon className="h-[1.125rem] w-[1.125rem]" />,
                run: () => (prefs.isUnread(menuTarget) ? prefs.markRead(menu.number) : prefs.markUnread(menu.number)),
                danger: false,
              },
              {
                key: "delete",
                label: "Delete chat",
                icon: <TrashIcon className="h-[1.125rem] w-[1.125rem]" />,
                run: () => onDelete(menu.number),
                danger: true,
              },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  item.run();
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.9375rem] font-medium transition-colors hover:bg-slate-900/5 dark:hover:bg-white/10 lg:py-2.5 ${
                  item.danger ? "text-[#C0272D] dark:text-[#ff6b72]" : "text-slate-800 dark:text-slate-100"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
