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

export const SendIcon = ({ className }: IconProps) => (
  <Outline className={className}>
    <path d="M21.4 3.3 2.9 10.6a.6.6 0 0 0 0 1.1l6.6 2.6 2.6 6.6a.6.6 0 0 0 1.1 0l7.2-18.4a.6.6 0 0 0-.9-.8ZM9.6 14.2l8-8" />
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
