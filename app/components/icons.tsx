// Every icon in the app lives here, drawn to one style so they read as a set:
// 24 by 24 grid, round caps and joins, a single 1.8 line weight (ticks are a
// little heavier because they are drawn very small), and a few solid shapes
// (play, pause, dots, keypad) where a filled glyph is the convention.
//
// They are decorative by default (hidden from screen readers): the button or
// text next to an icon carries the accessible name.

export type IconProps = { className?: string };

const WEIGHT = 1.8;

function Outline({
  className,
  weight = WEIGHT,
  children,
}: IconProps & { weight?: number; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

function Solid({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      {children}
    </svg>
  );
}

// --- Navigation and actions -------------------------------------------------

export const PhoneIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z" />
  </Outline>
);

export const MessageIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
  </Outline>
);

export const PeopleIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <circle cx="9" cy="8" r="3" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16.5 8.5a3 3 0 1 1 3.9 2.86" />
    <path d="M16 14.5c2.7.4 4.5 1.9 5 3.5" />
  </Outline>
);

export const PersonPlusIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M18 8v6M15 11h6" />
  </Outline>
);

// Two lines running into one arrow: "merge these calls".
export const MergeIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M3 6.5h3.5A5.5 5.5 0 0 1 12 12" />
    <path d="M3 17.5h3.5A5.5 5.5 0 0 0 12 12" />
    <path d="M12 12h9M18 9l3 3-3 3" />
  </Outline>
);

export const GearIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Outline>
);

export const SearchIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Outline>
);

export const PlusIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M12 5v14M5 12h14" />
  </Outline>
);

export const CloseIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Outline>
);

export const TrashIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
    <path d="M10 11v6M14 11v6" />
  </Outline>
);

export const CopyIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Outline>
);

export const ForwardIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="m15 4 6 6-6 6M21 10H9a6 6 0 0 0-6 6v3" />
  </Outline>
);

export const DownloadIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" />
  </Outline>
);

export const LockIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <rect x="5" y="11" width="14" height="9.5" rx="2.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Outline>
);

export const FingerprintIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M12 10a2 2 0 0 1 2 2c0 2.8-.6 5-2.5 7" />
    <path d="M8.5 14.5c.7-1 1-2 1-3.5a2.5 2.5 0 0 1 5 0c0 .3 0 .6-.03.9" />
    <path d="M5.5 12.5c0-.7.1-1.4.3-2" />
    <path d="M17.7 16.6c.5-1.5.8-3 .8-4.6a6.5 6.5 0 0 0-11.4-4.3" />
    <path d="M12 3a9 9 0 0 1 9 9c0 .8-.06 1.5-.2 2.2" />
    <path d="M3.1 15a9 9 0 0 1-.1-3" />
  </Outline>
);

// --- Arrows and chevrons -----------------------------------------------------

export const ArrowLeftIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </Outline>
);

export const ArrowRightIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </Outline>
);

// Call direction marks in the call list. Drawn to fill the grid: they are
// shown at 12 to 14 pixels next to text, so a small drawing would vanish.
export const ArrowDownRightIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M6 6l12 12M18 8v10H8" />
  </Outline>
);

export const ArrowUpRightIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M6 18 18 6M8 6h10v10" />
  </Outline>
);

export const ChevronDownIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="m6 9 6 6 6-6" />
  </Outline>
);

export const ChevronRightIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="m9 6 6 6-6 6" />
  </Outline>
);

// --- Delivery marks (drawn tiny, so a touch heavier) ---------------------------

export const CheckIcon = ({ className }: IconProps) => (
  <Outline className={className} weight={2.2}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Outline>
);

export const DoubleCheckIcon = ({ className }: IconProps) => (
  <Outline className={className} weight={2.2}>
    <path d="m2 12.5 4.5 4.5L16 7.5" />
    <path d="m10.5 16.6.4.4L20.5 7.5" />
  </Outline>
);

// --- Calling ---------------------------------------------------------------------

export const MicIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <rect x="9" y="2.5" width="6" height="12" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5" />
  </Outline>
);

export const MicOffIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M9 9v2a3 3 0 0 0 5.12 2.12M12 2a3 3 0 0 1 3 3v4c0 .3-.03.6-.08.88M5 10a7 7 0 0 0 9.5 6.6M19 10a7 7 0 0 1-.34 2.17" />
    <path d="M12 19v3" />
    <path d="M3 3l18 18" />
  </Outline>
);

export const SpeakerIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M11 5 6 9H3v6h3l5 4Z" />
    <path d="M16 8a5 5 0 0 1 0 8" />
    <path d="M19 5a9 9 0 0 1 0 14" />
  </Outline>
);

export const KeypadIcon = ({ className }: IconProps) => (
  <Solid className={className}>
    {[5, 12, 19].flatMap((cy) => [5, 12, 19].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" />))}
  </Solid>
);

export const BackspaceIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M9 5H20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6.5-7Z" />
    <path d="M13 10l4 4M17 10l-4 4" />
  </Outline>
);

// --- Solid glyphs ------------------------------------------------------------------

export const PauseIcon = ({ className }: IconProps) => (
  <Solid className={className}>
    <rect x="6" y="5" width="4.2" height="14" rx="1.2" />
    <rect x="13.8" y="5" width="4.2" height="14" rx="1.2" />
  </Solid>
);

// The triangle's visual centre (a third of the way in from its flat side) sits
// on the middle of the grid, so it needs no nudging inside a round button.
export const PlayIcon = ({ className }: IconProps) => (
  <Solid className={className}>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
  </Solid>
);

export const DotsIcon = ({ className }: IconProps) => (
  <Solid className={className}>
    <circle cx="12" cy="5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="19" r="1.8" />
  </Solid>
);

// --- Chat composer ---------------------------------------------------------------------

export const SmileIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <circle cx="12" cy="12" r="9.2" />
    <path d="M8.2 14.2c.9 1.3 2.2 2 3.8 2s2.9-.7 3.8-2" />
    <path d="M9 9.6h.01M15 9.6h.01" strokeWidth="2.6" />
  </Outline>
);

export const KeyboardIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10" strokeWidth="2" />
  </Outline>
);

export const PaperclipIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="m20.5 11.5-8.6 8.6a5.2 5.2 0 0 1-7.4-7.4l8.9-8.9a3.5 3.5 0 0 1 5 5l-8.9 8.9a1.8 1.8 0 0 1-2.5-2.5l8.2-8.2" />
  </Outline>
);

// A paper plane: one closed outline and a single fold line that runs from the
// tip back to the body. (An earlier version drew the fold as a separate path
// that ended on the outline, which left a double dot at the tip.)
export const SendIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="m21.5 2.5-6.6 19a.6.6 0 0 1-1.1.05L10.6 14 2.5 10.8a.6.6 0 0 1 .05-1.1Z" />
    <path d="M21.5 2.5 10.6 14" />
  </Outline>
);

export const CameraIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.4-2h6.2l1.4 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z" />
    <circle cx="12" cy="13" r="3.4" />
  </Outline>
);

export const ImageIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m20.5 16-4.6-4.6a1 1 0 0 0-1.4 0L6 19.5" />
  </Outline>
);

export const PinIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6ZM12 14v7" />
  </Outline>
);

export const MailIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m3.5 7 8.5 6 8.5-6" />
  </Outline>
);

// --- Message and chat actions -------------------------------------------------------

export const StarIcon = ({ className, filled = false }: IconProps & { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={WEIGHT} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
    <path d="m12 3.2 2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.6l6-.9Z" />
  </svg>
);

export const ReplyIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="m9 14-5-5 5-5" />
    <path d="M4 9h10a6 6 0 0 1 6 6v3" />
  </Outline>
);

export const InfoIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <circle cx="12" cy="12" r="9.2" />
    <path d="M12 11v5.5M12 7.6h.01" strokeWidth="2.2" />
  </Outline>
);

export const PencilIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7.5 18.5 3 20l1.5-4.5Z" />
    <path d="m14.5 5.5 3 3" />
  </Outline>
);

export const ArchiveIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <rect x="3" y="4" width="18" height="4.5" rx="1.2" />
    <path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5M10 12.5h4" />
  </Outline>
);

export const BellIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
    <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
  </Outline>
);

export const BellOffIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M8.5 4.7A6 6 0 0 1 18 9c0 2.6.4 4.4.9 5.6M6 9c0 6-2.5 7.5-2.5 7.5H14" />
    <path d="M10 19.5a2.2 2.2 0 0 0 4 0M3 3l18 18" />
  </Outline>
);

export const BanIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <circle cx="12" cy="12" r="9.2" />
    <path d="m5.7 5.7 12.6 12.6" />
  </Outline>
);

export const TagIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M3 12.3V4.5A1.5 1.5 0 0 1 4.5 3h7.8a1.5 1.5 0 0 1 1.06.44l7.2 7.2a1.5 1.5 0 0 1 0 2.12l-7.8 7.8a1.5 1.5 0 0 1-2.12 0l-7.2-7.2A1.5 1.5 0 0 1 3 12.3Z" />
    <circle cx="8" cy="8" r="1.3" />
  </Outline>
);

export const TimerIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <circle cx="12" cy="13.5" r="7.5" />
    <path d="M12 9.5v4l2.5 1.5M9.5 2.5h5" />
  </Outline>
);

export const CheckSquareIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
    <path d="m8 12.3 2.8 2.8L16.5 9" />
  </Outline>
);

export const MapPinIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M12 21.5s7-6.1 7-11.5a7 7 0 0 0-14 0c0 5.4 7 11.5 7 11.5Z" />
    <circle cx="12" cy="10" r="2.6" />
  </Outline>
);

export const PollIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Outline>
);

export const CalendarIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Outline>
);

export const UserCardIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
    <circle cx="9" cy="11" r="2.3" />
    <path d="M5.2 16.6a4 4 0 0 1 7.6 0M15 9.5h3.5M15 13h3.5" />
  </Outline>
);

export const FileIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </Outline>
);

export const VideoIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
    <path d="m15.5 10.5 6-3.5v10l-6-3.5" />
  </Outline>
);

export const MusicIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M9 18V5l11-2v13" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="17.5" cy="16" r="2.5" />
  </Outline>
);

export const StickerIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M20.5 12A8.5 8.5 0 1 1 12 3.5h.3a1 1 0 0 1 .9.6l.9 2a1 1 0 0 0 .9.6h3.6a1 1 0 0 1 1 1v.3" />
    <path d="M20.5 12H16a3.5 3.5 0 0 0-3.5 3.5V20" />
    <path d="M8.5 10h.01M12 8.5h.01" strokeWidth="2.4" />
  </Outline>
);

export const BroadcastIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <circle cx="12" cy="12" r="2" />
    <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
  </Outline>
);

export const QrIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
    <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
    <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" />
    <path d="M14 14h2.5v2.5H14zM19 14h1.5M14 19.5h6.5M17.5 17v2.5" />
  </Outline>
);

export const ShieldIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M12 2.8 4.5 5.6v6.1c0 4.6 3.2 8.2 7.5 9.6 4.3-1.4 7.5-5 7.5-9.6V5.6Z" />
    <path d="m8.8 12 2.4 2.4 4.2-4.6" />
  </Outline>
);

export const DownloadCloudIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M7.5 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.6 1.46A3.75 3.75 0 0 1 17.5 18.5" />
    <path d="m9 15 3 3 3-3M12 18v-8" />
  </Outline>
);

export const ShareIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <circle cx="18" cy="5" r="2.6" />
    <circle cx="6" cy="12" r="2.6" />
    <circle cx="18" cy="19" r="2.6" />
    <path d="m8.3 10.7 7.4-4.4M8.3 13.3l7.4 4.4" />
  </Outline>
);

export const UsersPlusIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <circle cx="9" cy="8" r="3" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" />
  </Outline>
);

export const KeyIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <circle cx="8" cy="15" r="4.5" />
    <path d="m11.2 11.8 9-9M16.5 6.5l3 3M14 9l2 2" />
  </Outline>
);

export const HelpIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <circle cx="12" cy="12" r="9.2" />
    <path d="M9.4 9.2a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.3-2.6 3.9M12 17h.01" strokeWidth="2.2" />
  </Outline>
);
