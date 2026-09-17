import Image from "next/image";

// Kept strictly within the app's red/black/white/cream palette - no
// off-brand hues - while still varying enough (crimson, maroon, charcoal,
// near-black) that different people are easy to tell apart at a glance.
// Picked deterministically per name/number below, the same way
// Gmail/Google Voice color initial avatars.
const PALETTE = [
  "from-[#e0555c] to-[#C0272D]", // brand crimson
  "from-[#C0272D] to-[#7a1620]", // deep crimson / maroon
  "from-[#b0413a] to-[#5c1b1b]", // muted brick red
  "from-slate-600 to-slate-900", // charcoal
  "from-slate-800 to-black", // near-black
];

export const PRESET_COUNT = PALETTE.length;

function presetIndex(photoUrl: string | undefined): number | null {
  const match = photoUrl ? /^preset:(\d+)$/.exec(photoUrl) : null;
  if (!match) return null;
  const index = Number(match[1]);
  return index >= 0 && index < PALETTE.length ? index : null;
}

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function initialsFor(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "?";
  // A phone number (starts with +) gets its last two digits rather than
  // "+1" - more identifiable at a glance in a call/message list.
  if (trimmed.startsWith("+")) {
    const digits = trimmed.replace(/\D/g, "");
    return digits.slice(-2) || "#";
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZE_CLASSES: Record<"sm" | "md" | "lg" | "xl", string> = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
  xl: "h-20 w-20 text-xl",
};

export function Avatar({
  label,
  photoUrl,
  size = "md",
  className = "",
}: {
  label: string;
  photoUrl?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const sizeClass = SIZE_CLASSES[size];

  const preset = presetIndex(photoUrl);
  if (preset !== null) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-b text-white ring-2 ring-white/70 dark:ring-white/10 ${PALETTE[preset]} ${sizeClass} ${className}`}
        aria-hidden
      >
        <PersonIcon className="h-[58%] w-[58%]" />
      </span>
    );
  }

  if (photoUrl) {
    const px = size === "xl" ? 80 : size === "lg" ? 48 : size === "md" ? 36 : 28;
    return (
      <span
        className={`inline-block shrink-0 overflow-hidden rounded-full ring-2 ring-white/70 dark:ring-white/10 ${sizeClass} ${className}`}
      >
        <Image
          src={photoUrl}
          alt={label}
          width={px}
          height={px}
          unoptimized
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  const gradient = PALETTE[hashSeed(label) % PALETTE.length];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-b font-semibold text-white ring-2 ring-white/70 dark:ring-white/10 ${gradient} ${sizeClass} ${className}`}
      aria-hidden
    >
      {initialsFor(label)}
    </span>
  );
}
