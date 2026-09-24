"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EmojiPicker } from "./EmojiPicker";
import { CameraIcon, CloseIcon, ImageIcon, KeyboardIcon, MicIcon, PaperclipIcon, SendIcon, SmileIcon, TrashIcon } from "../icons";
import { prepareImage, type PreparedImage } from "@/lib/imageResize";
import {
  MAX_VOICE_SECONDS,
  VoiceError,
  formatClock,
  startRecording,
  voiceSupported,
  type RecorderHandle,
  type VoiceRecording,
} from "@/lib/voice";

const MAX_SMS_LENGTH = 1600;


const ROUND_BUTTON =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white shadow-[0_8px_18px_-8px_rgba(192,39,45,0.7)] transition-all active:scale-90 disabled:opacity-40 disabled:shadow-none";

const PILL_ICON =
  "flex h-11 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition-all active:scale-90 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200";

export function Composer({
  value,
  onChange,
  onSendText,
  onSendVoice,
  onSendPhoto,
  enterToSend,
  error,
  isDesktop,
  resetKey,
  busy,
  textareaRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSendText: () => void;
  onSendVoice: (recording: VoiceRecording) => void;
  onSendPhoto: (image: PreparedImage, caption: string) => void;
  enterToSend: boolean;
  error: string | null;
  isDesktop: boolean;
  /** Changes when the open chat changes, so panels and recordings reset. */
  resetKey: string;
  busy: boolean;
  textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (textareaRef) textareaRef.current = el;
    },
    [textareaRef],
  );
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [recording, setRecording] = useState<{ seconds: number; levels: number[] } | null>(null);
  const [starting, setStarting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [image, setImage] = useState<PreparedImage | null>(null);
  const handleRef = useRef<RecorderHandle | null>(null);
  const finishingRef = useRef(false);
  // After Send the button turns into the mic, so a quick second tap on Send
  // must not start a recording by accident.
  const lastSendRef = useRef(0);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const [canRecord, setCanRecord] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // A click anywhere else, or Escape, closes the emoji panel / attach menu.
  useEffect(() => {
    if (!emojiOpen && !attachOpen) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setEmojiOpen(false);
        setAttachOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setEmojiOpen(false);
        setAttachOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [emojiOpen, attachOpen]);

  useEffect(() => {
    const timer = setTimeout(() => setCanRecord(voiceSupported()), 0);
    return () => clearTimeout(timer);
  }, []);

  // The message box grows with what is typed (up to a few lines).
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value, image, recording]);

  // A different chat: drop panels, stop any recording, forget the picture.
  useEffect(() => {
    return () => {
      handleRef.current?.cancel();
      handleRef.current = null;
    };
  }, [resetKey]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setEmojiOpen(false);
      setAttachOpen(false);
      setRecording(null);
      setImage(null);
      setLocalError(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [resetKey]);

  function insertEmoji(emoji: string) {
    const el = innerRef.current;
    if (!el) {
      onChange((value + emoji).slice(0, MAX_SMS_LENGTH));
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = (value.slice(0, start) + emoji + value.slice(end)).slice(0, MAX_SMS_LENGTH);
    onChange(next);
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      el.setSelectionRange(caret, caret);
    });
  }

  function toggleEmoji() {
    setAttachOpen(false);
    setEmojiOpen((open) => {
      const next = !open;
      // On a phone the panel takes the keyboard's place.
      if (next && !isDesktop) innerRef.current?.blur();
      if (!next) innerRef.current?.focus();
      return next;
    });
  }

  async function begin() {
    if (starting || recording || Date.now() - lastSendRef.current < 800) return;
    setLocalError(null);
    setEmojiOpen(false);
    setAttachOpen(false);
    setStarting(true);
    try {
      const handle = await startRecording({
        onTick: (seconds) => setRecording((r) => (r ? { ...r, seconds } : r)),
        onLevel: (level) => setRecording((r) => (r ? { ...r, levels: [...r.levels.slice(-39), level] } : r)),
        onLimit: () => void finish(true),
      });
      handleRef.current = handle;
      finishingRef.current = false;
      setRecording({ seconds: 0, levels: [] });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not start recording.");
    } finally {
      setStarting(false);
    }
  }

  async function finish(send: boolean) {
    const handle = handleRef.current;
    if (!handle || finishingRef.current) return;
    finishingRef.current = true;
    handleRef.current = null;
    if (!send) {
      handle.cancel();
      setRecording(null);
      finishingRef.current = false;
      return;
    }
    try {
      const rec = await handle.stop();
      setRecording(null);
      onSendVoice(rec);
    } catch (err) {
      setRecording(null);
      setLocalError(err instanceof VoiceError ? err.message : "Could not send the voice message.");
    } finally {
      finishingRef.current = false;
    }
  }

  async function pickFile(file: File | undefined) {
    setAttachOpen(false);
    if (!file) return;
    setLocalError(null);
    try {
      setImage(await prepareImage(file));
      innerRef.current?.focus();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not use that picture.");
    }
  }

  const hasContent = value.trim().length > 0 || !!image;
  const shownError = localError ?? error;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    lastSendRef.current = Date.now();
    if (image) {
      onSendPhoto(image, value);
      setImage(null);
      setEmojiOpen(false);
      return;
    }
    onSendText();
    setEmojiOpen(false);
  }

  if (recording) {
    const bars = recording.levels;
    return (
      <div className="relative">
        <div className="flex items-center gap-2" role="group" aria-label="Recording a voice message">
          <button type="button" onClick={() => void finish(false)} className={`${PILL_ICON} !h-11 !w-11 rounded-full bg-slate-900/5 dark:bg-white/10`} aria-label="Cancel recording">
            <TrashIcon className="h-5 w-5" />
          </button>
          <div className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-3xl border border-slate-900/10 bg-white/90 px-4 dark:border-white/10 dark:bg-white/10">
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[#C0272D]" aria-hidden />
            <span className="w-10 shrink-0 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100" aria-live="off">
              {formatClock(recording.seconds)}
            </span>
            <div className="flex h-7 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden" aria-hidden>
              {bars.map((l, i) => (
                <span key={i} className="w-[3px] shrink-0 rounded-full bg-[#C0272D]/70" style={{ height: `${Math.max(12, Math.round(l * 100))}%` }} />
              ))}
            </div>
            <span className="shrink-0 text-[0.6875rem] text-slate-400">max {formatClock(MAX_VOICE_SECONDS)}</span>
          </div>
          <button type="button" onClick={() => void finish(true)} className={ROUND_BUTTON} aria-label="Send voice message">
            <SendIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      {shownError && <p className="px-2 pb-1.5 text-xs text-red-600 dark:text-red-400">{shownError}</p>}

      {image && (
        <div className="mb-2 flex items-center gap-3 rounded-2xl border border-slate-900/10 bg-white/80 p-2 animate-[slide-fade-in_0.2s_ease-out] dark:border-white/10 dark:bg-white/[0.06]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.previewUrl} alt="Picture to send" className="h-16 w-16 rounded-xl object-cover" />
          <p className="min-w-0 flex-1 text-sm text-slate-600 dark:text-slate-300">Ready to send. Add a caption below if you like.</p>
          <button type="button" onClick={() => setImage(null)} className={`${PILL_ICON} !h-9 !w-9`} aria-label="Remove picture">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {emojiOpen && isDesktop && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-[22rem] max-w-full animate-[pop-in_0.18s_ease-out]">
          <EmojiPicker onPick={insertEmoji} height="21rem" />
        </div>
      )}

      {attachOpen && (
        <div
          className="absolute bottom-full right-12 z-20 mb-2 w-52 overflow-hidden rounded-2xl border border-white/70 bg-white/95 p-1.5 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.35)] backdrop-blur-2xl animate-[pop-in_0.18s_ease-out] dark:border-white/10 dark:bg-[#17181c]/95"
          role="menu"
          aria-label="Attach"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => galleryRef.current?.click()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition-colors hover:bg-slate-900/5 dark:text-slate-100 dark:hover:bg-white/10"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white">
              <ImageIcon className="h-4 w-4" />
            </span>
            Photo
          </button>
          {!isDesktop && (
            <button
              type="button"
              role="menuitem"
              onClick={() => cameraRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition-colors hover:bg-slate-900/5 dark:text-slate-100 dark:hover:bg-white/10"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-b from-slate-700 to-slate-950 text-white">
                <CameraIcon className="h-4 w-4" />
              </span>
              Camera
            </button>
          )}
        </div>
      )}

      <input ref={galleryRef} type="file" accept="image/*" className="hidden" aria-label="Choose a photo" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Take a photo" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }} />

      <form onSubmit={submit} className="flex items-end gap-2">
        <div className="relative flex min-w-0 flex-1 items-end rounded-3xl border border-slate-900/10 bg-white/90 shadow-[inset_0_1px_3px_rgba(15,23,42,0.06)] focus-within:border-[#C0272D]/40 dark:border-white/10 dark:bg-white/10">
          <button
            type="button"
            onClick={toggleEmoji}
            onMouseDown={(e) => e.preventDefault()}
            className={PILL_ICON}
            aria-label={emojiOpen && !isDesktop ? "Show keyboard" : "Emoji"}
            aria-expanded={emojiOpen}
          >
            {emojiOpen && !isDesktop ? <KeyboardIcon className="h-6 w-6" /> : <SmileIcon className="h-6 w-6" />}
          </button>
          <textarea
            ref={setRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => {
              // On a phone the keyboard and the panel share the same space, so
              // typing closes the panel. On a computer both can stay open.
              if (!isDesktop) setEmojiOpen(false);
              setAttachOpen(false);
            }}
            onKeyDown={(e) => {
              // Enter sends on a computer; on a phone it is a new line, since
              // the on-screen keyboard has no Shift.
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                enterToSend &&
                window.matchMedia("(hover: hover) and (pointer: fine)").matches
              ) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={1}
            maxLength={MAX_SMS_LENGTH}
            placeholder={image ? "Add a caption" : "Message"}
            className="block max-h-[120px] min-h-[44px] min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-[10px] text-base leading-snug text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-50 dark:placeholder:text-slate-500"
            aria-label="Message"
          />
          <button
            type="button"
            onClick={() => {
              setEmojiOpen(false);
              setAttachOpen((open) => !open);
            }}
            onMouseDown={(e) => e.preventDefault()}
            className={PILL_ICON}
            aria-label="Attach"
            aria-expanded={attachOpen}
            aria-haspopup="menu"
          >
            <PaperclipIcon className="h-[1.375rem] w-[1.375rem]" />
          </button>
          {value.length > MAX_SMS_LENGTH - 200 && (
            <span className="pointer-events-none absolute -top-4 right-3 text-[0.625rem] text-slate-400">
              {value.length}/{MAX_SMS_LENGTH}
            </span>
          )}
        </div>

        {hasContent || !canRecord ? (
          <button
            type="submit"
            // Keeps the keyboard open after sending, so you can keep typing.
            onPointerDown={(e) => e.preventDefault()}
            disabled={!hasContent || busy}
            className={ROUND_BUTTON}
            aria-label="Send"
          >
            <SendIcon className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => void begin()}
            disabled={starting || busy}
            className={ROUND_BUTTON}
            aria-label="Record voice message"
          >
            <MicIcon className="h-[1.375rem] w-[1.375rem]" />
          </button>
        )}
      </form>

      {emojiOpen && !isDesktop && (
        <div className="mt-2 animate-[slide-fade-in_0.18s_ease-out]">
          <EmojiPicker onPick={insertEmoji} height="16rem" />
        </div>
      )}
    </div>
  );
}
