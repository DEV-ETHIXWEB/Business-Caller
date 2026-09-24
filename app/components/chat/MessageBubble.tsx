"use client";

import { useRef, useState } from "react";
import type { ThreadMessage } from "@/lib/messageThread";
import { isEmojiOnly } from "@/lib/emoji";
import {
  parseBlocks,
  parseContactCard,
  parseEvent,
  parseLocation,
  parsePoll,
  parseReply,
  type ContactCard,
  type Vote,
} from "@/lib/richText";
import { MediaView } from "./MediaViews";
import { MessageTicks } from "./MessageTicks";
import { RichBlocks } from "./RichText";
import { ContactCardView, EventCard, LocationCard, PollCard } from "./StructuredCards";
import { ReplyIcon, StarIcon } from "../icons";

export interface BubbleProps {
  m: ThreadMessage;
  out: boolean;
  /** The previous message is from the same side, so this one joins its run. */
  grouped: boolean;
  selected: boolean;
  isPending: boolean;
  highlight?: string;
  reaction?: string;
  starred: boolean;
  /** Replies that count as votes if this message is a poll or an event. */
  votes: Vote[];
  isKnownNumber: (number: string) => boolean;
  /** Off = photos, videos and voice notes wait for a tap before loading. */
  autoLoadMedia: boolean;
  /** Broadcast lists show who a reply came from. */
  senderLabel?: string;
  onSelect: (mode: "toggle" | "start") => void;
  onSwipeReply: () => void;
  onJumpToQuote: (snippet: string) => void;
  onVote: (option: number) => void;
  onRsvp: (answer: "YES" | "NO" | "MAYBE") => void;
  onMessageNumber: (number: string) => void;
  onSaveContact: (card: ContactCard) => void;
}

const SWIPE_TRIGGER = 56;
const LONG_PRESS_MS = 460;

export function MessageBubble(p: BubbleProps) {
  const { m, out } = p;
  const [dx, setDx] = useState(0);
  const gesture = useRef<{ x: number; y: number; id: number; timer: number; swiping: boolean; longPressed: boolean } | null>(null);
  const suppressClick = useRef(false);

  const { quote, rest } = parseReply(m.body);
  const hasMedia = !!m.media?.length;
  const poll = !hasMedia ? parsePoll(rest) : null;
  const event = !hasMedia && !poll ? parseEvent(rest) : null;
  const location = !hasMedia && !poll && !event ? parseLocation(rest) : null;
  const card = !hasMedia && !poll && !event && !location ? parseContactCard(rest) : null;
  const structured = !!(poll || event || location || card);
  const emojiOnly = !hasMedia && !structured && quote === null && isEmojiOnly(rest);
  const blocks = !structured && rest ? parseBlocks(rest) : [];
  const simple = blocks.length === 1 && blocks[0].t === "p";

  const time = (
    <span
      className={`inline-flex select-none items-center gap-1 text-[0.625rem] leading-none ${
        emojiOnly ? "text-slate-400 dark:text-slate-500" : out ? "text-white/75" : "text-slate-400"
      }`}
    >
      {p.starred && <StarIcon filled className="h-2.5 w-2.5" />}
      <span>{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      {out && <MessageTicks status={m.status} />}
    </span>
  );

  // Touch only: a long press starts selecting, and a short horizontal drag
  // replies (the same two gestures WhatsApp has). Mouse users click instead.
  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse" || p.isPending) return;
    const g = { x: e.clientX, y: e.clientY, id: e.pointerId, timer: 0, swiping: false, longPressed: false };
    g.timer = window.setTimeout(() => {
      g.longPressed = true;
      suppressClick.current = true;
      if ("vibrate" in navigator) navigator.vibrate?.(10);
      p.onSelect("start");
    }, LONG_PRESS_MS);
    gesture.current = g;
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    const ddx = e.clientX - g.x;
    const ddy = e.clientY - g.y;
    if (!g.swiping && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) window.clearTimeout(g.timer);
    if (ddx > 12 && Math.abs(ddy) < Math.abs(ddx) / 1.6) {
      g.swiping = true;
      setDx(Math.min(ddx, 84));
    }
  }

  function endGesture(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    window.clearTimeout(g.timer);
    if (g.swiping) {
      suppressClick.current = true;
      if (dx >= SWIPE_TRIGGER) {
        if ("vibrate" in navigator) navigator.vibrate?.(8);
        p.onSwipeReply();
      }
    }
    gesture.current = null;
    setDx(0);
  }

  const bubbleClass = emojiOnly
    ? "px-1 py-0.5"
    : `${hasMedia || structured ? "p-1" : "px-3 py-1.5"} shadow-[0_1px_1.5px_rgba(15,23,42,0.14)] ${
        out
          ? `rounded-2xl bubble-out ${p.grouped ? "" : "bubble-tail-out rounded-tr-none"}`
          : `rounded-2xl bg-white text-slate-800 dark:bg-[#26272c] dark:text-slate-100 ${p.grouped ? "" : "bubble-tail-in rounded-tl-none"}`
      }`;

  return (
    <div
      className="relative touch-pan-y"
      style={dx ? { transform: `translateX(${dx}px)`, transition: "none" } : { transition: "transform 0.18s ease-out" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      {dx > 8 && (
        <span
          className="pointer-events-none absolute -left-9 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/10 text-slate-600 dark:bg-white/15 dark:text-slate-200"
          style={{ opacity: Math.min(1, dx / SWIPE_TRIGGER), transform: `translateY(-50%) scale(${dx >= SWIPE_TRIGGER ? 1.15 : 0.9})` }}
          aria-hidden
        >
          <ReplyIcon className="h-4 w-4" />
        </span>
      )}

      {p.senderLabel && !out && <p className="mb-0.5 ml-1 text-[0.6875rem] font-semibold text-[#C0272D] dark:text-[#ff6b72]">{p.senderLabel}</p>}

      <div
        onClick={(e) => {
          e.stopPropagation();
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (!p.isPending) p.onSelect("toggle");
        }}
        className={`relative text-[0.9375rem] leading-snug ${bubbleClass} ${p.selected ? "rounded-2xl outline outline-2 outline-offset-2 outline-[#C0272D]/50" : ""}`}
      >
        {quote !== null && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              p.onJumpToQuote(quote);
            }}
            className={`mb-1 block w-full rounded-lg border-l-4 px-2 py-1 text-left text-[0.8125rem] leading-snug ${
              out ? "border-white/70 bg-black/15 text-white/90" : "border-[#C0272D] bg-slate-900/[0.05] text-slate-600 dark:bg-white/[0.07] dark:text-slate-300"
            }`}
            aria-label="Go to the quoted message"
          >
            <span className="line-clamp-2 [overflow-wrap:anywhere]">{quote}</span>
          </button>
        )}

        {hasMedia && (
          <div className="flex flex-col gap-1">
            {m.media!.map((media) => (
              <div key={media.sid} className={media.kind === "audio" ? "px-2 pt-1.5" : ""}>
                <MediaView media={media} out={out} deferred={!p.autoLoadMedia} />
              </div>
            ))}
          </div>
        )}

        {poll && <PollCard poll={poll} votes={p.votes} out={out} onVote={out ? undefined : p.onVote} />}
        {event && <EventCard event={event} votes={p.votes} out={out} onRsvp={out ? undefined : p.onRsvp} />}
        {location && <LocationCard loc={location} out={out} />}
        {card && <ContactCardView card={card} out={out} known={p.isKnownNumber(card.number)} onMessage={() => p.onMessageNumber(card.number)} onSave={() => p.onSaveContact(card)} />}

        {emojiOnly ? (
          <div className={`flex flex-col ${out ? "items-end" : "items-start"} gap-1`}>
            <p className="text-[2.75rem] leading-none">{rest.trim()}</p>
            {time}
          </div>
        ) : structured ? (
          <div className="flex justify-end px-2 pb-0.5 pt-1">{time}</div>
        ) : hasMedia ? (
          <div className={rest ? "px-2 pb-1 pt-1.5" : "px-2 pb-1 pt-0.5"}>
            {rest && <RichBlocks blocks={blocks} highlight={p.highlight} />}
            <div className="mt-0.5 flex justify-end">{time}</div>
          </div>
        ) : simple ? (
          /* The time floats to the end of the last line (WhatsApp style), so
             short messages stay one compact bubble. */
          <RichBlocks blocks={blocks} highlight={p.highlight} floatTime={<span className="float-right ml-2.5 mt-[7px]">{time}</span>} />
        ) : (
          <>
            {rest && <RichBlocks blocks={blocks} highlight={p.highlight} />}
            <div className="mt-0.5 flex justify-end">{time}</div>
          </>
        )}
      </div>

      {p.reaction && (
        <span
          className={`relative -mt-1.5 inline-flex rounded-full border border-slate-900/10 bg-white px-1.5 py-0.5 text-sm leading-none shadow-sm dark:border-white/10 dark:bg-[#26272c] ${out ? "float-right mr-2" : "ml-2"}`}
          aria-label={`Reaction ${p.reaction}`}
          data-testid="reaction-chip"
        >
          {p.reaction}
        </span>
      )}
    </div>
  );
}
