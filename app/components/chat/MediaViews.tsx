"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ThreadMedia } from "@/lib/messageThread";
import { VoicePlayer } from "./VoicePlayer";
import { CloseIcon, DownloadIcon } from "../icons";



// Full-screen picture viewer: dark backdrop, tap outside or Escape to close.
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portalled to the page root so the blurred chat panel around the message
  // cannot trap this full-screen view inside itself.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Picture"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 animate-[fade-in_0.15s_ease-out]"
      onClick={onClose}
    >
      <div className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex gap-2">
        <a
          href={src}
          download
          onClick={(e) => e.stopPropagation()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-all active:scale-90"
          aria-label="Download picture"
        >
          <DownloadIcon className="h-5 w-5" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-all active:scale-90"
          aria-label="Close picture"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Picture in the chat, full size" className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  );
}

function ImageMessage({ media }: { media: ThreadMedia }) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!broken) setOpen(true);
        }}
        className="block overflow-hidden rounded-xl"
        aria-label="Open picture"
      >
        {broken ? (
          <span className="flex h-24 w-40 items-center justify-center bg-slate-900/10 text-xs text-slate-500">Picture unavailable</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.url}
            alt="Picture in the chat"
            loading="lazy"
            onError={() => setBroken(true)}
            className="block max-h-72 w-auto min-w-[8rem] max-w-[min(17rem,62vw)] object-cover"
          />
        )}
      </button>
      {open && <Lightbox src={media.url} onClose={() => setOpen(false)} />}
    </>
  );
}

// One attachment inside a message bubble.
export function MediaView({ media, out }: { media: ThreadMedia; out: boolean }) {
  if (media.kind === "audio") return <VoicePlayer media={media} out={out} />;
  if (media.kind === "image") return <ImageMessage media={media} />;
  if (media.kind === "video") {
    return (
      <video
        src={media.url}
        controls
        preload="metadata"
        playsInline
        onClick={(e) => e.stopPropagation()}
        className="block max-h-72 max-w-[min(17rem,62vw)] rounded-xl bg-black"
      />
    );
  }
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-2 rounded-xl bg-black/10 px-3 py-2 text-sm underline"
    >
      <DownloadIcon className="h-4 w-4" />
      Attachment
    </a>
  );
}
