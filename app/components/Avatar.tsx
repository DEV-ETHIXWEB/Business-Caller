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

// A colored glow to match each palette entry, used only on the preset
// avatars (see below) - initials avatars stay flat/cheap since they can
// appear dozens of times in a list.
const GLOW = [
  "shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_0_22px_-4px_rgba(224,85,92,0.9)]",
  "shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_0_22px_-4px_rgba(192,39,45,0.9)]",
  "shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_0_22px_-4px_rgba(176,65,58,0.9)]",
  "shadow-[0_0_0_1px_rgba(255,255,255,0.3),0_0_22px_-4px_rgba(100,116,139,0.8)]",
  "shadow-[0_0_0_1px_rgba(255,255,255,0.3),0_0_22px_-4px_rgba(192,39,45,0.55)]",
];

export const PRESET_COUNT = PALETTE.length;

function presetIndex(photoUrl: string | undefined): number | null {
  const match = photoUrl ? /^preset:(\d+)$/.exec(photoUrl) : null;
  if (!match) return null;
  const index = Number(match[1]);
  return index >= 0 && index < PALETTE.length ? index : null;
}

// A low-poly, faceted take on a person glyph for the preset avatars - each
// triangle/quad is the same shape lit from the top-left at a different
// opacity, the way a cut gemstone reads as one form built from many facets.
// Purely geometric (no photography, no per-preset asset files), so it
// stays crisp and on-brand at any size.
function FacetedPersonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <g fill="currentColor">
        <polygon points="12,8 12,3.7 15.72,5.85" opacity="0.95" />
        <polygon points="12,8 15.72,5.85 15.72,10.15" opacity="0.55" />
        <polygon points="12,8 15.72,10.15 12,12.3" opacity="0.3" />
        <polygon points="12,8 12,12.3 8.28,10.15" opacity="0.45" />
        <polygon points="12,8 8.28,10.15 8.28,5.85" opacity="0.75" />
        <polygon points="12,8 8.28,5.85 12,3.7" opacity="0.6" />
        <polygon points="3,21 12,21 12,12.5 8,14" opacity="0.85" />
        <polygon points="21,21 12,21 12,12.5 16,14" opacity="0.55" />
      </g>
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
        className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br text-white ${PALETTE[preset]} ${GLOW[preset]} ${sizeClass} ${className}`}
        aria-hidden
      >
        {/* Glossy top-left highlight, like light hitting a glass sphere. */}
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_22%,rgba(255,255,255,0.55),transparent_58%)]" />
        <FacetedPersonIcon className="relative h-[60%] w-[60%] drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)]" />
        {/* Slow diagonal light sweep - a subtle "holographic foil" touch. */}
        <span className="avatar-shimmer pointer-events-none absolute inset-y-0 -left-full w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
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
