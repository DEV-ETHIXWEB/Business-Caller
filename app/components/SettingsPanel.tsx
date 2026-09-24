"use client";

import { Avatar } from "./Avatar";
import { ChevronRightIcon, CloseIcon } from "./icons";
import type { Settings, ThemeSetting, TextSizeSetting, WallpaperSetting, BubbleTheme, MessageSound } from "@/lib/settings";
import type { LockConfig } from "@/lib/lock";

export interface ProfileStatusValue {
  emoji: string;
  text: string;
}

const SECTION_CLASS =
  "rounded-3xl border border-white/70 bg-white/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_12px_28px_-18px_rgba(15,23,42,0.25)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_28px_-18px_rgba(0,0,0,0.8)]";

const LABEL_CLASS = "text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400";



export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-2xl bg-slate-900/5 p-1 dark:bg-white/5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`min-w-0 flex-1 rounded-xl px-1 py-2 text-xs font-semibold transition-all active:scale-95 ${
              active
                ? "bg-gradient-to-b from-[#e0555c] to-[#C0272D] text-white shadow-[0_6px_14px_-6px_rgba(192,39,45,0.7)]"
                : "text-slate-600 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-white/10"
            }`}
          >
            <span className="block truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
          checked ? "bg-gradient-to-b from-[#e0555c] to-[#C0272D]" : "bg-slate-300 dark:bg-white/15"
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-[0_2px_5px_rgba(15,23,42,0.35)] transition-all ${
            checked ? "left-[1.375rem]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

const WALLPAPER_SWATCHES: { value: WallpaperSetting; label: string; className: string }[] = [
  {
    value: "dots",
    label: "Dots",
    className:
      "bg-[radial-gradient(circle_at_3px_3px,rgba(192,39,45,0.35)_1.2px,transparent_1.6px)] [background-size:12px_12px] bg-[#faf6f5] dark:bg-[#15161a]",
  },
  {
    value: "blush",
    label: "Blush",
    className: "bg-gradient-to-b from-[#f6dcdc] via-[#faf3f2] to-[#f3d6d6] dark:from-[#3a1216] dark:via-[#15161a] dark:to-[#2b0e12]",
  },
  { value: "plain", label: "Plain", className: "bg-[#faf6f5] dark:bg-[#15161a]" },
];

export function SettingsPanel({
  settings,
  onChange,
  name,
  callerId,
  avatarUrl,
  status,
  about,
  onEditProfile,
  onSignOut,
  signOutDisabled,
  onClose,
  blocked,
  onUnblock,
  onBackup,
  onRestore,
  onPreviewSound,
  onRequestNotifications,
  lock,
  onSetupLock,
  onChangePin,
  onDisableLock,
  onSetAutoLock,
  onSetupSecret,
  onClearSecret,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  name: string;
  callerId: string;
  avatarUrl?: string;
  status?: ProfileStatusValue;
  about?: string;
  onEditProfile: () => void;
  onSignOut: () => void;
  signOutDisabled: boolean;
  onClose: () => void;
  blocked: { number: string; name?: string }[];
  onUnblock: (number: string) => void;
  onBackup: () => void;
  onRestore: (file: File) => void;
  onPreviewSound: (sound: MessageSound) => void;
  /** Asks the browser for notification permission; resolves to whether it was granted. */
  onRequestNotifications: () => Promise<boolean>;
  lock: LockConfig | null;
  onSetupLock: () => void;
  onChangePin: () => void;
  onDisableLock: () => void;
  onSetAutoLock: (minutes: number) => void;
  onSetupSecret: () => void;
  onClearSecret: () => void;
}) {
  const themeOptions: { value: ThemeSetting; label: string }[] = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];
  const sizeOptions: { value: TextSizeSetting; label: string }[] = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
    { value: "xlarge", label: "Extra large" },
  ];

  return (
    <div
      className="fixed inset-0 z-40 flex items-stretch justify-center bg-black/40 backdrop-blur-sm animate-[fade-in_0.2s_ease-out] lg:items-center lg:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col overflow-hidden bg-gradient-to-br from-[#F7F2F1] via-white to-[#F5EFEE] animate-[chat-in_0.22s_ease-out] dark:from-[#0c0d10] dark:via-[#120a0b] dark:to-black lg:h-auto lg:max-h-[calc(100dvh-3rem)] lg:max-w-md lg:rounded-[2rem] lg:border lg:border-white/70 lg:shadow-[0_25px_70px_-20px_rgba(192,39,45,0.25)] lg:animate-[pop-in_0.25s_cubic-bezier(0.16,1,0.3,1)] dark:lg:border-white/10"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-900/5 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-white/5 lg:pt-4">
          <h2 className="text-xl font-semibold tracking-wide text-slate-900 dark:text-white">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition-all active:scale-90 active:bg-slate-900/5 dark:text-slate-300 dark:active:bg-white/10"
            aria-label="Close settings"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onEditProfile}
            className={`${SECTION_CLASS} flex w-full items-center gap-3 text-left transition-all active:scale-[0.99]`}
          >
            <Avatar label={name} photoUrl={avatarUrl} size="xl" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold text-slate-900 dark:text-white">{name}</span>
              <span className="block truncate text-sm text-slate-600 dark:text-slate-300">
                {status ? `${status.emoji} ${status.text}`.trim() : "Set your status"}
              </span>
              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{about || callerId}</span>
            </span>
            <ChevronRightIcon className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" />
          </button>

          <section className={SECTION_CLASS} aria-label="Appearance">
            <p className={LABEL_CLASS}>Appearance</p>

            <p className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-100">Theme</p>
            <div className="mt-2">
              <Segmented label="Theme" value={settings.theme} options={themeOptions} onChange={(theme) => onChange({ theme })} />
            </div>

            <p className="mt-4 text-sm font-medium text-slate-800 dark:text-slate-100">Text size</p>
            <div className="mt-2">
              <Segmented label="Text size" value={settings.textSize} options={sizeOptions} onChange={(textSize) => onChange({ textSize })} />
            </div>

            <p className="mt-4 text-sm font-medium text-slate-800 dark:text-slate-100">Chat wallpaper</p>
            <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Chat wallpaper">
              {WALLPAPER_SWATCHES.map((w) => {
                const active = settings.wallpaper === w.value;
                return (
                  <button
                    key={w.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${w.label} wallpaper`}
                    onClick={() => onChange({ wallpaper: w.value })}
                    className={`flex flex-col items-center gap-1.5 rounded-2xl p-1.5 transition-all active:scale-95 ${
                      active ? "ring-2 ring-[#C0272D] ring-offset-2 ring-offset-white dark:ring-offset-[#0c0d10]" : ""
                    }`}
                  >
                    <span className={`block h-14 w-full rounded-xl border border-slate-900/10 dark:border-white/10 ${w.className}`} />
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{w.label}</span>
                  </button>
                );
              })}
            </div>


            <p className="mt-4 text-sm font-medium text-slate-800 dark:text-slate-100">Bubble colour</p>
            <div className="mt-2 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Bubble colour">
              {(
                [
                  ["crimson", "Crimson", "from-[#e0555c] to-[#C0272D]"],
                  ["wine", "Wine", "from-[#9a2f3d] to-[#5b1420]"],
                  ["charcoal", "Charcoal", "from-[#64748b] to-[#334155]"],
                  ["black", "Black", "from-[#3b3d45] to-[#0f1013]"],
                ] as [BubbleTheme, string, string][]
              ).map(([value, label, grad]) => {
                const active = settings.bubbleTheme === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${label} bubbles`}
                    onClick={() => onChange({ bubbleTheme: value })}
                    className={`flex flex-col items-center gap-1.5 rounded-2xl p-1.5 transition-all active:scale-95 ${active ? "ring-2 ring-[#C0272D] ring-offset-2 ring-offset-white dark:ring-offset-[#0c0d10]" : ""}`}
                  >
                    <span className={`block h-9 w-full rounded-xl bg-gradient-to-b ${grad}`} />
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
                  </button>
                );
              })}
            </div>

            <div className="chat-wallpaper mt-4 space-y-1.5 rounded-2xl border border-slate-900/5 p-3 dark:border-white/5" aria-hidden>
              <div className="flex justify-start">
                <p className="max-w-[80%] rounded-2xl rounded-tl-none bg-white px-3 py-1.5 text-[0.9375rem] leading-snug text-slate-800 shadow-[0_1px_1.5px_rgba(15,23,42,0.14)] dark:bg-[#26272c] dark:text-slate-100">
                  This is how your messages look.
                </p>
              </div>
              <div className="flex justify-end">
                <p className="max-w-[80%] rounded-2xl rounded-tr-none bubble-out px-3 py-1.5 text-[0.9375rem] leading-snug shadow-[0_1px_1.5px_rgba(15,23,42,0.14)]">
                  Looks great to me.
                </p>
              </div>
            </div>
          </section>

          <section className={SECTION_CLASS} aria-label="Chats">
            <p className={LABEL_CLASS}>Chats</p>
            <div className="mt-1">
              <Toggle
                label="Enter is send"
                hint="On a computer keyboard, Enter sends and Shift+Enter starts a new line."
                checked={settings.enterToSend}
                onChange={(enterToSend) => onChange({ enterToSend })}
              />
              <Toggle
                label="Send reactions as a text"
                hint="Your emoji reaction is also texted to the other person. Each one is a normal SMS and is billed as one."
                checked={settings.reactionsAsText}
                onChange={(reactionsAsText) => onChange({ reactionsAsText })}
              />
            </div>
          </section>

          <section className={SECTION_CLASS} aria-label="Media">
            <p className={LABEL_CLASS}>Media</p>
            <div className="mt-1">
              <Toggle
                label="Auto-download media"
                hint="Load photos, videos and voice notes as soon as a chat opens. Turn off to tap each one to load it and save data."
                checked={settings.autoDownload}
                onChange={(autoDownload) => onChange({ autoDownload })}
              />
            </div>
          </section>

          <section className={SECTION_CLASS} aria-label="Notifications">
            <p className={LABEL_CLASS}>Notifications</p>
            <p className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-100">Message sound</p>
            <div className="mt-2">
              <Segmented
                label="Message sound"
                value={settings.messageSound}
                options={[
                  { value: "chime", label: "Chime" },
                  { value: "pop", label: "Pop" },
                  { value: "bell", label: "Bell" },
                  { value: "off", label: "Off" },
                ]}
                onChange={(messageSound) => {
                  onChange({ messageSound });
                  onPreviewSound(messageSound);
                }}
              />
            </div>
            <div className="mt-2 divide-y divide-slate-900/5 dark:divide-white/5">
              <Toggle
                label="Desktop notifications"
                hint="A pop-up for a new text while this tab is in the background. It only works while the page is open."
                checked={settings.desktopNotifications}
                onChange={async (on) => {
                  if (!on) return onChange({ desktopNotifications: false });
                  onChange({ desktopNotifications: await onRequestNotifications() });
                }}
              />
              <Toggle
                label="Show message text"
                hint="Off shows just &quot;New message&quot; in a notification."
                checked={settings.notifyPreview}
                onChange={(notifyPreview) => onChange({ notifyPreview })}
              />
            </div>
          </section>

          <section className={SECTION_CLASS} aria-label="Sounds and haptics">
            <p className={LABEL_CLASS}>Sounds and haptics</p>
            <div className="mt-1 divide-y divide-slate-900/5 dark:divide-white/5">
              <Toggle label="Tap sounds" checked={settings.sounds} onChange={(sounds) => onChange({ sounds })} />
              <Toggle
                label="Vibration"
                hint="Works on Android. iPhones do not allow web apps to vibrate."
                checked={settings.haptics}
                onChange={(haptics) => onChange({ haptics })}
              />
            </div>
          </section>

          <section className={SECTION_CLASS} aria-label="Privacy">
            <p className={LABEL_CLASS}>Privacy</p>
            <p className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-100">Blocked contacts</p>

            {blocked.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">No one is blocked. Block someone from their chat menu.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {blocked.map((b) => (
                  <li key={b.number} className="flex items-center justify-between gap-2 rounded-xl bg-slate-900/5 px-3 py-2 dark:bg-white/5">
                    <span className="min-w-0 truncate text-sm text-slate-800 dark:text-slate-100">{b.name ?? b.number}</span>
                    <button type="button" onClick={() => onUnblock(b.number)} className="shrink-0 text-xs font-semibold text-[#C0272D] dark:text-[#ff6b72]" aria-label={`Unblock ${b.name ?? b.number}`}>
                      Unblock
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Blocking is only in this app: it hides the chat and stops you sending. The person can still text your number, and Twilio still receives it.
            </p>
          
            <p className="mt-4 text-sm font-medium text-slate-800 dark:text-slate-100">App lock</p>
            {lock ? (
              <>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">A PIN protects Business Caller on this device. It is checked here, not sent anywhere.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={onChangePin} className="flex-1 rounded-full bg-slate-900/5 py-2 text-xs font-semibold text-slate-800 active:scale-95 dark:bg-white/10 dark:text-slate-100">
                    Change PIN
                  </button>
                  <button type="button" onClick={onDisableLock} className="flex-1 rounded-full bg-slate-900/5 py-2 text-xs font-semibold text-[#C0272D] active:scale-95 dark:bg-white/10 dark:text-[#ff6b72]">
                    Turn off
                  </button>
                </div>
                <p className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-100">Lock again after</p>
                <div className="mt-2">
                  <Segmented
                    label="Lock again after"
                    value={String(lock.autoLockMinutes)}
                    options={[
                      { value: "0", label: "Manually" },
                      { value: "1", label: "1 min" },
                      { value: "15", label: "15 min" },
                      { value: "60", label: "1 hour" },
                    ]}
                    onChange={(v) => onSetAutoLock(Number(v))}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">Secret code</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">Type it in the Texts search box to reveal locked chats.</span>
                  </span>
                  <button type="button" onClick={lock.secret ? onClearSecret : onSetupSecret} className="shrink-0 text-xs font-semibold text-[#C0272D] dark:text-[#ff6b72]">
                    {lock.secret ? "Remove" : "Set up"}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" onClick={onSetupLock} className="mt-2 w-full rounded-full bg-slate-900/5 py-2.5 text-sm font-semibold text-slate-800 active:scale-[0.98] dark:bg-white/10 dark:text-slate-100">
                Set up a PIN
              </button>
            )}
</section>

          <section className={SECTION_CLASS} aria-label="Backup">
            <p className={LABEL_CLASS}>Backup</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Your texts already live in Twilio. This saves the rest (pins, stars, favourites, labels, drafts and so on) so you can move them to another phone or computer.
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={onBackup} className="flex-1 rounded-full bg-slate-900/5 py-2.5 text-sm font-semibold text-slate-800 active:scale-[0.98] dark:bg-white/10 dark:text-slate-100">
                Back up
              </button>
              <label className="flex flex-1 cursor-pointer items-center justify-center rounded-full bg-slate-900/5 py-2.5 text-sm font-semibold text-slate-800 active:scale-[0.98] dark:bg-white/10 dark:text-slate-100">
                Restore
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  aria-label="Restore a backup file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) onRestore(f);
                  }}
                />
              </label>
            </div>
          </section>

          <button
            type="button"
            onClick={onSignOut}
            disabled={signOutDisabled}
            className={`${SECTION_CLASS} w-full py-3 text-center text-sm font-semibold text-[#C0272D] dark:text-[#ff6b72] transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40`}
          >
            Sign out
          </button>

          <p className="pb-2 text-center text-xs text-slate-400 dark:text-slate-500">Business Caller by Ethixweb</p>
        </div>
      </div>
    </div>
  );
}
