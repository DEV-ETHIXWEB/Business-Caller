"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "../Avatar";
import { ArchiveIcon, BanIcon, BellIcon, BellOffIcon, CameraIcon, CheckSquareIcon, DotsIcon, MailIcon, MicIcon, PaperclipIcon, PinIcon, PlusIcon, StarIcon, TagIcon, TrashIcon } from "../icons";
import { FOREVER, type ChatPrefsApi } from "@/lib/chatPrefs";
import type { ConversationSummary } from "@/lib/messageThread";
import { previewLabel } from "@/lib/richText";

export type ListFilter = string; // "all" | "unread" | "favorites" | "pinned" | "archived" | "label:<id>" | "lists"

export const LABEL_COLORS = ["#C0272D", "#e0555c", "#b0413a", "#475569", "#0f172a", "#d97706"];

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
  view: "root" | "mute" | "labels";
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
        <span className="truncate">{c.lastBody ? previewLabel(c.lastBody) : label}</span>
      </p>
    );
  }
  return (
    <p className={`mt-0.5 truncate text-[0.8125rem] ${tone}`}>
      {you}
      {previewLabel(c.lastBody) || "Message"}
    </p>
  );
}

const MUTE_CHOICES: { label: string; ms: number }[] = [
  { label: "8 hours", ms: 8 * 3600e3 },
  { label: "1 week", ms: 7 * 24 * 3600e3 },
  { label: "Always", ms: FOREVER },
];

// The Texts inbox: filter chips and the rows, WhatsApp style. Each row can be
// pinned, favourited, archived, muted, labelled, blocked or deleted from a menu
// (long press on a phone, right click or the dots on a computer), and several
// can be handled at once in select mode.
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
  onDeleteMany,
  selectMode,
  onSelectModeChange,
  extraRows,
  onToast,
  showLocked = false,
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
  onDeleteMany: (numbers: string[]) => void;
  selectMode: boolean;
  onSelectModeChange: (on: boolean) => void;
  /** Rows shown above the chats (broadcast lists). */
  extraRows?: React.ReactNode;
  onToast: (message: string) => void;
  /** Shows only locked chats, revealed by a PIN or the secret code. */
  showLocked?: boolean;
}) {
  const [filter, setFilter] = useState<ListFilter>("all");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [labelColor, setLabelColor] = useState(LABEL_COLORS[0]);
  const pressRef = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);

  const q = search.trim().toLowerCase();
  const visibleBase = conversations.filter((c) => !prefs.isBlocked(c.number) && (showLocked || !prefs.isLocked(c.number)));
  const matches = visibleBase.filter((c) => {
    if (!q) return true;
    return (nameFor(c.number) ?? "").toLowerCase().includes(q) || c.number.includes(q) || c.lastBody.toLowerCase().includes(q);
  });
  const archivedCount = visibleBase.filter((c) => prefs.isArchived(c.number)).length;
  const unreadCount = visibleBase.filter((c) => !prefs.isArchived(c.number) && prefs.isUnread(c)).length;
  const favoriteCount = visibleBase.filter((c) => prefs.isFavorite(c.number)).length;
  const pinnedCount = visibleBase.filter((c) => prefs.isPinned(c.number)).length;

  const inFilter = (c: ConversationSummary): boolean => {
    if (showLocked) return prefs.isLocked(c.number);
    if (filter === "archived") return prefs.isArchived(c.number);
    if (prefs.isArchived(c.number)) return false;
    if (filter === "unread") return prefs.isUnread(c);
    if (filter === "favorites") return prefs.isFavorite(c.number);
    if (filter === "pinned") return prefs.isPinned(c.number);
    if (filter.startsWith("label:")) return (prefs.prefs.chatLabels[c.number] ?? []).includes(filter.slice(6));
    return true;
  };
  const visible = matches
    .filter(inFilter)
    .sort((a, b) => Number(prefs.isPinned(b.number)) - Number(prefs.isPinned(a.number)) || b.lastAt - a.lastAt);

  useEffect(() => {
    if (!menu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  // Leaving select mode forgets what was ticked.
  useEffect(() => {
    if (!selectMode) {
      const t = setTimeout(() => setSelected([]), 0);
      return () => clearTimeout(t);
    }
  }, [selectMode]);

  // A filter whose chats are all gone (say the last archived chat came back)
  // falls back to All instead of showing an empty page.
  useEffect(() => {
    const t = setTimeout(() => {
      if (filter === "archived" && archivedCount === 0) setFilter("all");
      if (filter.startsWith("label:") && !prefs.prefs.labelDefs.some((l) => l.id === filter.slice(6))) setFilter("all");
    }, 0);
    return () => clearTimeout(t);
  }, [filter, archivedCount, prefs.prefs.labelDefs]);

  function openMenu(number: string, x: number, y: number) {
    setMenu({ number, x, y, view: "root" });
  }

  const chip = (id: ListFilter, label: string, count?: number, color?: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      aria-pressed={filter === id}
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
        filter === id
          ? "bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white shadow-[0_6px_14px_-6px_rgba(192,39,45,0.7)]"
          : "border border-slate-900/10 bg-white/60 text-slate-600 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
      }`}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />}
      {label}
      {count ? <span className="opacity-80">{count}</span> : null}
    </button>
  );

  const menuTarget = menu ? conversations.find((c) => c.number === menu.number) : undefined;
  const menuName = menu ? (nameFor(menu.number) ?? menu.number) : "";

  const rowItem = (key: string, label: string, icon: React.ReactNode, run: () => void, danger = false, keep = false) => (
    <button
      key={key}
      type="button"
      role="menuitem"
      onClick={() => {
        if (!keep) setMenu(null);
        run();
      }}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.9375rem] font-medium transition-colors hover:bg-slate-900/5 dark:hover:bg-white/10 lg:py-2.5 ${
        danger ? "text-[#C0272D] dark:text-[#ff6b72]" : "text-slate-800 dark:text-slate-100"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  const bulk = (fn: (n: string) => void) => {
    selected.forEach(fn);
    onSelectModeChange(false);
  };

  return (
    <>
      {!showLocked && (
      <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5" role="group" aria-label="Filter chats">
        {chip("all", "All")}
        {chip("unread", "Unread", unreadCount)}
        {chip("favorites", "Favourites", favoriteCount)}
        {chip("pinned", "Pinned", pinnedCount)}
        {archivedCount > 0 && chip("archived", "Archived", archivedCount)}
        {prefs.prefs.labelDefs.map((l) => chip(`label:${l.id}`, l.name, undefined, l.color))}
      </div>
      )}

      {selectMode && !showLocked && (
        <div className="mt-2 flex items-center gap-1 rounded-2xl bg-slate-900/[0.06] px-2 py-1.5 dark:bg-white/[0.08]" role="toolbar" aria-label="Chat selection">
          <p className="flex-1 truncate pl-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{selected.length} selected</p>
          {[
            { key: "pin", label: "Pin", icon: <PinIcon className="h-[1.125rem] w-[1.125rem]" />, run: () => bulk((n) => prefs.togglePin(n)) },
            { key: "archive", label: "Archive", icon: <ArchiveIcon className="h-[1.125rem] w-[1.125rem]" />, run: () => bulk((n) => prefs.toggleArchive(n)) },
            { key: "mute", label: "Mute", icon: <BellOffIcon className="h-[1.125rem] w-[1.125rem]" />, run: () => bulk((n) => prefs.mute(n, FOREVER)) },
            { key: "read", label: "Mark as read", icon: <CheckSquareIcon className="h-[1.125rem] w-[1.125rem]" />, run: () => bulk((n) => prefs.markRead(n)) },
          ].map((b) => (
            <button key={b.key} type="button" disabled={!selected.length} onClick={b.run} aria-label={b.label} title={b.label} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-700 transition-all hover:bg-slate-900/5 active:scale-90 disabled:opacity-30 dark:text-slate-200 dark:hover:bg-white/10">
              {b.icon}
            </button>
          ))}
          <button
            type="button"
            disabled={!selected.length}
            onClick={() => {
              onDeleteMany(selected);
              onSelectModeChange(false);
            }}
            aria-label="Delete selected chats"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#C0272D] transition-all hover:bg-[#C0272D]/10 active:scale-90 disabled:opacity-30 dark:text-[#ff6b72]"
          >
            <TrashIcon className="h-[1.125rem] w-[1.125rem]" />
          </button>
          <button type="button" onClick={() => onSelectModeChange(false)} className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/10">
            Done
          </button>
        </div>
      )}

      <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto pb-24 lg:pb-4" role="list" aria-label="Conversations">
        {filter === "all" && !q && extraRows}
        {loading && conversations.length === 0 && <p className="p-4 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</p>}
        {!loading && visible.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {conversations.length === 0
              ? "No conversations yet."
              : showLocked
                ? "No locked chats."
                : q
                ? "No conversations match your search."
                : filter === "unread"
                  ? "No unread chats."
                  : filter === "pinned"
                    ? "No pinned chats. Long press or right click a chat to pin it."
                    : filter === "favorites"
                      ? "No favourites yet. Add one from a chat's menu."
                      : filter === "archived"
                        ? "No archived chats."
                        : filter.startsWith("label:")
                          ? "No chats have this label."
                          : "No conversations match."}
          </p>
        )}
        {visible.map((c) => {
          const name = nameFor(c.number);
          const unread = prefs.isUnread(c);
          const pinned = prefs.isPinned(c.number);
          const muted = prefs.isMuted(c.number);
          const favorite = prefs.isFavorite(c.number);
          const active = activeNumber === c.number;
          const draft = prefs.prefs.drafts[c.number];
          const labels = (prefs.prefs.chatLabels[c.number] ?? []).map((id) => prefs.prefs.labelDefs.find((l) => l.id === id)).filter((l) => !!l);
          const ticked = selected.includes(c.number);
          return (
            <div
              key={c.number}
              role="listitem"
              className={`group relative flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all active:scale-[0.99] ${
                active || ticked
                  ? "border-[#C0272D]/25 bg-[#C0272D]/[0.07] dark:border-[#C0272D]/30 dark:bg-[#C0272D]/[0.14]"
                  : "border-white/50 bg-white/40 hover:bg-white/70 dark:border-white/5 dark:bg-white/[0.03] dark:hover:bg-white/[0.08]"
              }`}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selectMode) openMenu(c.number, e.clientX, e.clientY);
              }}
            >
              {selectMode && (
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs ${ticked ? "border-[#C0272D] bg-[#C0272D] text-white" : "border-slate-300 dark:border-white/25"}`}
                  role="checkbox"
                  aria-checked={ticked}
                  aria-label={`Select ${name ?? c.number}`}
                >
                  {ticked && "✓"}
                </span>
              )}
              <button
                type="button"
                onPointerDown={(e) => {
                  if (e.pointerType === "mouse" || selectMode) return;
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
                  if (selectMode) setSelected((cur) => (cur.includes(c.number) ? cur.filter((n) => n !== c.number) : [...cur, c.number]));
                  else onOpen(c.number);
                }}
                className="flex min-w-0 flex-1 select-none items-center gap-3 text-left [-webkit-touch-callout:none]"
              >
                <Avatar label={name ?? c.number} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className={`flex items-center gap-1.5 text-[0.9375rem] text-slate-800 dark:text-slate-100 ${unread ? "font-bold" : "font-semibold"}`}>
                    <span className="truncate">{name ?? c.number}</span>
                    {favorite && <StarIcon filled className="h-3 w-3 shrink-0 text-amber-500" aria-hidden />}
                    {labels.slice(0, 3).map((l) => (
                      <span key={l!.id} className="h-2 w-2 shrink-0 rounded-full" style={{ background: l!.color }} title={l!.name} aria-hidden />
                    ))}
                  </p>
                  <Preview c={c} draft={draft && !active ? draft : undefined} unread={unread} />
                </div>
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1.5 self-stretch py-0.5">
                <span className={`text-[0.6875rem] ${unread && !muted ? "font-semibold text-[#C0272D] dark:text-[#ff6b72]" : "text-slate-500 dark:text-slate-400"}`}>{relativeDay(c.lastAt)}</span>
                <div className="flex items-center gap-1.5">
                  {muted && <span data-testid="muted-icon" title="Muted"><BellOffIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" /></span>}
                  {pinned && <PinIcon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" aria-hidden />}
                  {unread && <span className={`h-2.5 w-2.5 rounded-full ${muted ? "bg-slate-400" : "bg-[#C0272D] shadow-[0_0_0_3px_rgba(192,39,45,0.18)]"}`} role="img" aria-label="Unread" />}
                  {!selectMode && (
                    <button
                      type="button"
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        openMenu(c.number, r.right, r.bottom);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-all hover:bg-slate-900/5 hover:text-slate-600 active:scale-90 focus-visible:opacity-100 dark:text-slate-400 dark:hover:bg-white/10 lg:h-6 lg:w-6 lg:opacity-0 lg:group-hover:opacity-100"
                      aria-label={`More options for ${name ?? c.number}`}
                      aria-haspopup="menu"
                    >
                      <DotsIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Portalled to the page root: the glass panel around the list blurs its
          background, which would otherwise trap a fixed menu inside it and
          leave it hidden behind the tab bar. */}
      {menu &&
        menuTarget &&
        createPortal(
          <div className={`fixed inset-0 z-50 ${isDesktop ? "" : "bg-black/30 animate-[fade-in_0.15s_ease-out]"}`} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
            <div
              role="menu"
              aria-label={`Options for ${menuName}`}
              onClick={(e) => e.stopPropagation()}
              className={
                isDesktop
                  ? "absolute max-h-[80vh] w-60 overflow-y-auto rounded-2xl border border-white/70 bg-white/95 p-1.5 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.4)] backdrop-blur-2xl animate-[pop-in_0.15s_ease-out] dark:border-white/10 dark:bg-[#17181c]/95"
                  : "absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl border-t border-white/70 bg-white p-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-20px_50px_-15px_rgba(15,23,42,0.4)] animate-[slide-fade-in_0.2s_ease-out] dark:border-white/10 dark:bg-[#17181c]"
              }
              style={isDesktop ? { left: Math.min(menu.x, window.innerWidth - 250), top: Math.max(8, Math.min(menu.y, window.innerHeight - 470)) } : undefined}
            >
              {!isDesktop && <p className="px-2 pb-2 pt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{menuName}</p>}

              {menu.view === "root" && (
                <>
                  {rowItem("pin", prefs.isPinned(menu.number) ? "Unpin chat" : "Pin chat", <PinIcon className="h-[1.125rem] w-[1.125rem]" />, () => prefs.togglePin(menu.number))}
                  {rowItem("unread", prefs.isUnread(menuTarget) ? "Mark as read" : "Mark as unread", <MailIcon className="h-[1.125rem] w-[1.125rem]" />, () => (prefs.isUnread(menuTarget) ? prefs.markRead(menu.number) : prefs.markUnread(menu.number)))}
                  {rowItem("favorite", prefs.isFavorite(menu.number) ? "Remove from favourites" : "Add to favourites", <StarIcon filled={prefs.isFavorite(menu.number)} className="h-[1.125rem] w-[1.125rem]" />, () => prefs.toggleFavorite(menu.number))}
                  {rowItem("archive", prefs.isArchived(menu.number) ? "Unarchive chat" : "Archive chat", <ArchiveIcon className="h-[1.125rem] w-[1.125rem]" />, () => {
                    onToast(prefs.isArchived(menu.number) ? "Chat unarchived" : "Chat archived");
                    prefs.toggleArchive(menu.number);
                  })}
                  {prefs.isMuted(menu.number)
                    ? rowItem("unmute", "Unmute notifications", <BellIcon className="h-[1.125rem] w-[1.125rem]" />, () => prefs.mute(menu.number, 0))
                    : rowItem("mute", "Mute notifications", <BellOffIcon className="h-[1.125rem] w-[1.125rem]" />, () => setMenu({ ...menu, view: "mute" }), false, true)}
                  {rowItem("labels", "Labels", <TagIcon className="h-[1.125rem] w-[1.125rem]" />, () => setMenu({ ...menu, view: "labels" }), false, true)}
                  {rowItem("lock", prefs.isLocked(menu.number) ? "Unlock chat" : "Lock chat", <span className="flex h-[1.125rem] w-[1.125rem] items-center justify-center text-base leading-none">{"🔒"}</span>, () => prefs.toggleLock(menu.number))}
                  {rowItem("select", "Select chats", <CheckSquareIcon className="h-[1.125rem] w-[1.125rem]" />, () => {
                    onSelectModeChange(true);
                    setSelected([menu.number]);
                  })}
                  {rowItem("block", prefs.isBlocked(menu.number) ? "Unblock" : "Block", <BanIcon className="h-[1.125rem] w-[1.125rem]" />, () => {
                    onToast(prefs.isBlocked(menu.number) ? "Unblocked" : `${menuName} blocked`);
                    prefs.toggleBlock(menu.number);
                  })}
                  {rowItem("delete", "Delete chat", <TrashIcon className="h-[1.125rem] w-[1.125rem]" />, () => onDelete(menu.number), true)}
                </>
              )}

              {menu.view === "mute" && (
                <>
                  <p className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Mute for</p>
                  {MUTE_CHOICES.map((m) =>
                    rowItem(`mute-${m.label}`, m.label, <BellOffIcon className="h-[1.125rem] w-[1.125rem]" />, () => {
                      prefs.mute(menu.number, m.ms);
                      onToast(`Muted for ${m.label.toLowerCase()}`);
                    }),
                  )}
                  {rowItem("back", "Back", <span aria-hidden>{"←"}</span>, () => setMenu({ ...menu, view: "root" }), false, true)}
                </>
              )}

              {menu.view === "labels" && (
                <>
                  <p className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Labels</p>
                  {prefs.prefs.labelDefs.length === 0 && <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">No labels yet. Make one below.</p>}
                  {prefs.prefs.labelDefs.map((l) => {
                    const on = (prefs.prefs.chatLabels[menu.number] ?? []).includes(l.id);
                    return (
                      <div key={l.id} className="flex items-center">
                        <button
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={on}
                          onClick={() => prefs.toggleChatLabel(menu.number, l.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[0.9375rem] font-medium text-slate-800 hover:bg-slate-900/5 dark:text-slate-100 dark:hover:bg-white/10"
                        >
                          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: l.color }} aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{l.name}</span>
                          <span className={`flex h-5 w-5 items-center justify-center rounded-md border-2 text-[0.6875rem] ${on ? "border-[#C0272D] bg-[#C0272D] text-white" : "border-slate-300 dark:border-white/25"}`} aria-hidden>{on && "✓"}</span>
                        </button>
                        <button type="button" onClick={() => prefs.removeLabel(l.id)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-900/5 dark:text-slate-400 dark:hover:bg-white/10" aria-label={`Delete label ${l.name}`}>
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                  <form
                    className="mt-1 border-t border-slate-900/5 px-2 pt-2 dark:border-white/5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newLabel.trim()) return;
                      const id = prefs.addLabel(newLabel, labelColor);
                      prefs.toggleChatLabel(menu.number, id);
                      setNewLabel("");
                    }}
                  >
                    <div className="flex gap-1.5" role="radiogroup" aria-label="Label colour">
                      {LABEL_COLORS.map((c) => (
                        <button key={c} type="button" role="radio" aria-checked={labelColor === c} aria-label={`Colour ${c}`} onClick={() => setLabelColor(c)} className={`h-6 w-6 rounded-full ${labelColor === c ? "ring-2 ring-slate-900 ring-offset-2 ring-offset-white dark:ring-white dark:ring-offset-[#17181c]" : ""}`} style={{ background: c }} />
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} maxLength={24} placeholder="New label" aria-label="New label name" className="min-w-0 flex-1 rounded-xl border border-slate-900/10 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-[#C0272D]/40 dark:border-white/10 dark:bg-white/5 dark:text-slate-50" />
                      <button type="submit" disabled={!newLabel.trim()} className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white disabled:opacity-40" aria-label="Add label">
                        <PlusIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </form>
                  {rowItem("back", "Back", <span aria-hidden>{"←"}</span>, () => setMenu({ ...menu, view: "root" }), false, true)}
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
