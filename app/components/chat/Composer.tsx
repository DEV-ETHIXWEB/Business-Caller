"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EmojiPicker } from "./EmojiPicker";
import {
  CalendarIcon,
  CameraIcon,
  CloseIcon,
  FileIcon,
  ImageIcon,
  KeyboardIcon,
  MapPinIcon,
  MicIcon,
  MusicIcon,
  PaperclipIcon,
  PollIcon,
  SendIcon,
  SmileIcon,
  StickerIcon,
  TrashIcon,
  UserCardIcon,
  VideoIcon,
} from "../icons";
import { mediaKindLabel, prepareAttachments, type PreparedAttachment } from "@/lib/attachments";
import { applyFormat, type FormatKind } from "@/lib/formatting";
import { emojiToSticker } from "@/lib/stickers";
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
  onSendAttachments,
  onAction,
  onSticker,
  username,
  filesApiRef,
  enterToSend,
  error,
  isDesktop,
  resetKey,
  busy,
  textareaRef,
  banner,
  onCancelBanner,
}: {
  value: string;
  onChange: (value: string) => void;
  onSendText: () => void;
  onSendVoice: (recording: VoiceRecording) => void;
  onSendAttachments: (attachments: PreparedAttachment[], caption: string) => void;
  /** Attach-menu entries that open their own dialog. */
  onAction: (action: "location" | "contact" | "poll" | "event") => void;
  /** Sends a sticker (a PNG picture). */
  onSticker: (dataUrl: string) => void;
  username: string;
  /** Lets the chat hand files to the composer (drag and drop). */
  filesApiRef?: React.MutableRefObject<{ addFiles: (files: File[]) => void } | null>;
  enterToSend: boolean;
  error: string | null;
  isDesktop: boolean;
  /** Changes when the open chat changes, so panels and recordings reset. */
  resetKey: string;
  busy: boolean;
  textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
  /** "Replying to..." or "Editing..." shown above the box. */
  banner?: { kind: "reply" | "edit"; title: string; text: string } | null;
  onCancelBanner?: () => void;
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
  const [attachments, setAttachments] = useState<PreparedAttachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [emojiMode, setEmojiMode] = useState<"emoji" | "stickers">("emoji");
  const [formatOpen, setFormatOpen] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const handleRef = useRef<RecorderHandle | null>(null);
  const finishingRef = useRef(false);
  // After Send the button turns into the mic, so a quick second tap on Send
  // must not start a recording by accident.
  const lastSendRef = useRef(0);
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

  // The formatting button appears while some text in the box is selected.
  useEffect(() => {
    function onSelectionChange() {
      const el = innerRef.current;
      setHasSelection(!!el && document.activeElement === el && el.selectionStart !== el.selectionEnd);
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

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
  }, [value, attachments, recording]);

  // Replying or editing puts you straight into the box.
  useEffect(() => {
    if (banner) innerRef.current?.focus();
  }, [banner]);

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
      setAttachments([]);
      setLocalError(null);
      setFormatOpen(false);
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

  // Prepares picked, pasted or dropped files (shrinks photos, checks types and
  // sizes) and adds them to the strip above the box.
  const addFiles = useCallback(
    async (files: File[]) => {
      setAttachOpen(false);
      if (!files.length) return;
      setLocalError(null);
      setPreparing(true);
      try {
        const { ready, errors } = await prepareAttachments(files, attachmentsRef.current);
        if (ready.length) {
          setAttachments((cur) => [...cur, ...ready]);
          innerRef.current?.focus();
        }
        if (errors.length) setLocalError(errors[0]);
      } finally {
        setPreparing(false);
      }
    },
    [],
  );
  const attachmentsRef = useRef<PreparedAttachment[]>([]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => {
    if (filesApiRef) filesApiRef.current = { addFiles: (files) => void addFiles(files) };
    return () => {
      if (filesApiRef) filesApiRef.current = null;
    };
  }, [filesApiRef, addFiles]);

  // Opens the file chooser for one kind of attachment.
  function choose(accept: string, multiple = true) {
    const el = pickerRef.current;
    if (!el) return;
    el.accept = accept;
    el.multiple = multiple;
    el.click();
  }

  async function sendSticker(s: { emoji?: string; dataUrl?: string }) {
    try {
      const dataUrl = s.dataUrl ?? (await emojiToSticker(s.emoji ?? ""));
      lastSendRef.current = Date.now();
      onSticker(dataUrl);
      setEmojiOpen(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not send the sticker.");
    }
  }

  function format(kind: FormatKind) {
    const el = innerRef.current;
    if (!el) return;
    const next = applyFormat(value, el.selectionStart ?? 0, el.selectionEnd ?? 0, kind);
    onChange(next.text.slice(0, MAX_SMS_LENGTH));
    setFormatOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  }

  const hasContent = value.trim().length > 0 || attachments.length > 0;
  const shownError = localError ?? error;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    lastSendRef.current = Date.now();
    if (attachments.length) {
      onSendAttachments(attachments, value);
      setAttachments([]);
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

      {banner && (
        <div
          className="mb-2 flex items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/80 py-1.5 pl-3 pr-1.5 animate-[slide-fade-in_0.18s_ease-out] dark:border-white/10 dark:bg-white/[0.06]"
          role="group"
          aria-label={banner.kind === "reply" ? "Replying" : "Editing"}
        >
          <span className="h-9 w-1 shrink-0 rounded-full bg-[#C0272D]" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-[#C0272D] dark:text-[#ff6b72]">{banner.title}</p>
            <p className="truncate text-[0.8125rem] text-slate-600 dark:text-slate-300">{banner.text}</p>
          </div>
          <button type="button" onClick={onCancelBanner} className={`${PILL_ICON} !h-9 !w-9`} aria-label={banner.kind === "reply" ? "Cancel reply" : "Cancel editing"}>
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {(attachments.length > 0 || preparing) && (
        <div className="mb-2 rounded-2xl border border-slate-900/10 bg-white/80 p-2 animate-[slide-fade-in_0.2s_ease-out] dark:border-white/10 dark:bg-white/[0.06]" role="group" aria-label="Attachments">
          <div className="flex gap-2 overflow-x-auto px-1 pb-1 pt-2">
            {attachments.map((a) => (
              <div key={a.id} className="relative shrink-0">
                {a.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.previewUrl} alt="Picture to send" className="h-16 w-16 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-xl bg-slate-900/[0.06] text-slate-600 dark:bg-white/10 dark:text-slate-300" aria-label={mediaKindLabel(a)}>
                    {a.kind === "video" ? <VideoIcon className="h-6 w-6" /> : a.kind === "audio" ? <MusicIcon className="h-6 w-6" /> : <FileIcon className="h-6 w-6" />}
                    <span className="text-[0.625rem] font-semibold">{mediaKindLabel(a).split(" ")[0]}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== a.id))}
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/80 text-white active:scale-90"
                  aria-label={`Remove ${mediaKindLabel(a)}`}
                >
                  <CloseIcon className="h-3 w-3" />
                </button>
              </div>
            ))}
            {preparing && <div className="flex h-16 w-16 shrink-0 animate-pulse items-center justify-center rounded-xl bg-slate-900/[0.06] text-xs text-slate-500 dark:bg-white/10">Preparing</div>}
          </div>
          <p className="mt-1 px-1 text-xs text-slate-500 dark:text-slate-400">
            {attachments.length > 1 ? `${attachments.length} files` : "Ready to send"}. Add a caption below if you like.
          </p>
        </div>
      )}

      {emojiOpen && isDesktop && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-[22rem] max-w-full animate-[pop-in_0.18s_ease-out]">
          <EmojiPicker key={emojiMode} onPick={insertEmoji} onSticker={(st) => void sendSticker(st)} username={username} initialMode={emojiMode} height="21rem" />
        </div>
      )}

      {attachOpen && (
        <div
          className="absolute bottom-full right-0 z-20 mb-2 w-[min(19rem,100%)] overflow-hidden rounded-3xl border border-white/70 bg-white p-2.5 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.35)] animate-[pop-in_0.18s_ease-out] dark:border-white/10 dark:bg-[#17181c]"
          role="menu"
          aria-label="Attach"
        >
          <div className="grid grid-cols-3 gap-1">
            {(
              [
                { key: "photo", label: "Photo", icon: <ImageIcon className="h-5 w-5" />, tone: "from-[#e0555c] to-[#C0272D]", run: () => choose("image/*") },
                ...(!isDesktop ? [{ key: "camera", label: "Camera", icon: <CameraIcon className="h-5 w-5" />, tone: "from-slate-700 to-slate-950", run: () => cameraRef.current?.click() }] : []),
                { key: "video", label: "Video", icon: <VideoIcon className="h-5 w-5" />, tone: "from-[#b0413a] to-[#5c1b1b]", run: () => choose("video/mp4,video/quicktime,video/3gpp,.mp4,.mov,.3gp") },
                { key: "audio", label: "Audio", icon: <MusicIcon className="h-5 w-5" />, tone: "from-slate-600 to-slate-900", run: () => choose("audio/*,.mp3,.m4a,.wav,.ogg,.amr") },
                { key: "document", label: "Document", icon: <FileIcon className="h-5 w-5" />, tone: "from-[#C0272D] to-[#7a1620]", run: () => choose("application/pdf,.pdf,text/vcard,.vcf") },
                { key: "gif", label: "GIF", icon: <ImageIcon className="h-5 w-5" />, tone: "from-slate-800 to-black", run: () => choose("image/gif,.gif") },
                { key: "location", label: "Location", icon: <MapPinIcon className="h-5 w-5" />, tone: "from-[#e0555c] to-[#C0272D]", run: () => onAction("location") },
                { key: "contact", label: "Contact", icon: <UserCardIcon className="h-5 w-5" />, tone: "from-slate-700 to-slate-950", run: () => onAction("contact") },
                { key: "poll", label: "Poll", icon: <PollIcon className="h-5 w-5" />, tone: "from-[#b0413a] to-[#5c1b1b]", run: () => onAction("poll") },
                { key: "event", label: "Event", icon: <CalendarIcon className="h-5 w-5" />, tone: "from-slate-600 to-slate-900", run: () => onAction("event") },
                {
                  key: "sticker",
                  label: "Sticker",
                  icon: <StickerIcon className="h-5 w-5" />,
                  tone: "from-[#C0272D] to-[#7a1620]",
                  run: () => {
                    setEmojiMode("stickers");
                    setEmojiOpen(true);
                  },
                },
              ] as { key: string; label: string; icon: React.ReactNode; tone: string; run: () => void }[]
            ).map((it) => (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setAttachOpen(false);
                  it.run();
                }}
                className="flex flex-col items-center gap-1.5 rounded-2xl px-1 py-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-900/5 active:scale-95 dark:text-slate-200 dark:hover:bg-white/10"
              >
                <span className={`flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-b text-white shadow-[0_6px_14px_-6px_rgba(15,23,42,0.5)] ${it.tone}`}>{it.icon}</span>
                {it.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {formatOpen && hasSelection && (
        <div
          role="menu"
          aria-label="Formatting"
          onMouseDown={(e) => e.preventDefault()}
          className="absolute bottom-full right-12 z-20 mb-2 flex flex-wrap gap-1 rounded-2xl border border-white/70 bg-white p-1.5 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.35)] animate-[pop-in_0.15s_ease-out] dark:border-white/10 dark:bg-[#17181c]"
        >
          {(
            [
              ["bold", "Bold", <b key="b">B</b>],
              ["italic", "Italic", <i key="i">I</i>],
              ["strike", "Strikethrough", <s key="s">S</s>],
              ["mono", "Monospace", <code key="m">{"</>"}</code>],
              ["quote", "Quote", <span key="q">{"\u201c"}</span>],
              ["bullet", "Bulleted list", <span key="u">{"\u2022"}</span>],
              ["numbered", "Numbered list", <span key="n">1.</span>],
              ["code", "Code block", <span key="c">{"{ }"}</span>],
            ] as [FormatKind, string, React.ReactNode][]
          ).map(([kind, label, glyph]) => (
            <button key={kind} type="button" role="menuitem" onClick={() => format(kind)} aria-label={label} title={label} className="flex h-9 w-9 items-center justify-center rounded-xl text-sm text-slate-700 hover:bg-slate-900/5 active:scale-90 dark:text-slate-200 dark:hover:bg-white/10">
              {glyph}
            </button>
          ))}
        </div>
      )}

      <input ref={pickerRef} type="file" multiple className="hidden" aria-label="Choose files" onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Take a photo" onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />

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
            onSelect={(e) => setHasSelection(e.currentTarget.selectionStart !== e.currentTarget.selectionEnd)}
            onPaste={(e) => {
              // A picture on the clipboard (a screenshot, a copied image) becomes an attachment.
              const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
              if (files.length) {
                e.preventDefault();
                void addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              // The same formatting shortcuts as WhatsApp Web.
              if ((e.metaKey || e.ctrlKey) && !e.altKey) {
                const k = e.key.toLowerCase();
                const kind: FormatKind | null = k === "b" && !e.shiftKey ? "bold" : k === "i" && !e.shiftKey ? "italic" : k === "x" && e.shiftKey ? "strike" : k === "m" && e.shiftKey ? "mono" : null;
                if (kind) {
                  e.preventDefault();
                  format(kind);
                  return;
                }
              }
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
            placeholder={attachments.length ? "Add a caption" : "Message"}
            className="block max-h-[120px] min-h-[44px] min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-[10px] text-base leading-snug text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-50 dark:placeholder:text-slate-500"
            aria-label="Message"
          />
          {hasSelection && (
            <button
              type="button"
              onClick={() => setFormatOpen((o) => !o)}
              onMouseDown={(e) => e.preventDefault()}
              className={`${PILL_ICON} !w-9 text-sm font-bold`}
              aria-label="Formatting"
              aria-haspopup="menu"
              aria-expanded={formatOpen}
            >
              Aa
            </button>
          )}
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
          <EmojiPicker key={emojiMode} onPick={insertEmoji} onSticker={(st) => void sendSticker(st)} username={username} initialMode={emojiMode} height="16rem" />
        </div>
      )}
    </div>
  );
}
