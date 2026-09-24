"use client";

// Stickers, without any paid service or picture library: a sticker is a large
// emoji drawn onto a transparent square and sent as a PNG picture message. You
// can also make your own from a photo. Nothing here leaves the browser until
// you send one.

export interface StickerPack {
  id: string;
  label: string;
  items: string[];
}

export const STICKER_PACKS: StickerPack[] = [
  { id: "faces", label: "Faces", items: ["😀", "😂", "🥹", "😍", "🥰", "😎", "🤩", "😭", "😡", "🤯", "😴", "🤔", "🥳", "😇", "🤗", "😬"] },
  { id: "reactions", label: "Reactions", items: ["👍", "👎", "👏", "🙌", "🤝", "🙏", "💪", "👌", "✌️", "🤞", "👋", "🫡", "❤️", "💔", "🔥", "💯"] },
  { id: "work", label: "Work", items: ["✅", "❌", "⏰", "📅", "📞", "📧", "💼", "📈", "📎", "🔒", "💡", "🎯", "🚀", "🏆", "📝", "☕"] },
  { id: "fun", label: "Fun", items: ["🎉", "🎂", "🎁", "🍕", "🍔", "🍻", "🎵", "🏖️", "🌈", "⭐", "🐶", "🐱", "🦄", "🌸", "☀️", "🌙"] },
];

const SIZE = 512;

// One emoji, large, centred on a transparent square.
export async function emojiToSticker(emoji: string): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not make the sticker.");
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(SIZE * 0.78)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.fillText(emoji, SIZE / 2, SIZE / 2 + SIZE * 0.05);
  return canvas.toDataURL("image/png");
}

// A photo cropped to a rounded square with a transparent background.
export async function photoToSticker(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that picture."));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    const out = 384;
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not make the sticker.");
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const r = 72;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(out, 0, out, out, r);
    ctx.arcTo(out, out, 0, out, r);
    ctx.arcTo(0, out, 0, 0, r);
    ctx.arcTo(0, 0, out, 0, r);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

const MY_KEY = (username: string) => `dialer_stickers:${username}`;
const MAX_MY_STICKERS = 12;

export function loadMyStickers(username: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MY_KEY(username)) || "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && x.startsWith("data:image/png;base64,")).slice(0, MAX_MY_STICKERS) : [];
  } catch {
    return [];
  }
}

export function saveMySticker(username: string, dataUrl: string): { list: string[]; saved: boolean } {
  const list = [dataUrl, ...loadMyStickers(username)].slice(0, MAX_MY_STICKERS);
  try {
    localStorage.setItem(MY_KEY(username), JSON.stringify(list));
    return { list, saved: true };
  } catch {
    // Storage full or blocked: the sticker can still be sent this session.
    return { list, saved: false };
  }
}

export function deleteMySticker(username: string, dataUrl: string): string[] {
  const list = loadMyStickers(username).filter((s) => s !== dataUrl);
  try {
    localStorage.setItem(MY_KEY(username), JSON.stringify(list));
  } catch {
    // Nothing to do.
  }
  return list;
}
