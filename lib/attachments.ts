"use client";

import { prepareImage } from "@/lib/imageResize";
import type { MediaKind } from "@/lib/messageThread";
import { blobToDataUrl } from "@/lib/voice";

// Everything a person can attach to a text. Picture messages have a small
// budget (the whole request is about 4.5 MB once encoded), so every file is
// checked, and photos are shrunk to fit alongside the others.

export const MAX_TOTAL_BYTES = 2.8 * 1024 * 1024;
export const MAX_FILES = 5;

export interface PreparedAttachment {
  id: string;
  dataUrl: string;
  kind: MediaKind;
  contentType: string;
  /** A local link to show it straight away. */
  previewUrl: string;
  name: string;
  bytes: number;
  peaks?: number[];
  seconds?: number;
}

const VIDEO_TYPES = ["video/mp4", "video/3gpp", "video/quicktime"];
const AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg", "audio/3gpp", "audio/amr", "audio/webm"];

function decodedBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
}

const uid = () => `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export class AttachmentError extends Error {}

function mimeFor(file: File): string {
  if (file.type) return file.type === "audio/x-m4a" || file.type === "audio/aac" ? "audio/mp4" : file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ({ mp4: "video/mp4", mov: "video/quicktime", "3gp": "video/3gpp", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", amr: "audio/amr", pdf: "application/pdf", vcf: "text/vcard", gif: "image/gif" } as Record<string, string>)[ext ?? ""] ?? "";
}

/**
 * Prepares one picked file. `budget` is how many bytes this file may use, so
 * a batch of photos shares the allowance instead of each taking all of it.
 */
export async function prepareAttachment(file: File, budget: number): Promise<PreparedAttachment> {
  const mime = mimeFor(file);

  if (mime === "image/gif") {
    // Kept as it is so it stays animated. It cannot be shrunk without losing that.
    if (file.size > budget) throw new AttachmentError("That GIF is too large to text. Try one under 2 MB.");
    const dataUrl = await blobToDataUrl(file);
    return { id: uid(), dataUrl, kind: "image", contentType: "image/gif", previewUrl: dataUrl, name: file.name, bytes: file.size };
  }

  if (mime.startsWith("image/")) {
    const img = await prepareImage(file, budget);
    return { id: uid(), dataUrl: img.dataUrl, kind: "image", contentType: "image/jpeg", previewUrl: img.previewUrl, name: file.name, bytes: decodedBytes(img.dataUrl) };
  }

  if (VIDEO_TYPES.includes(mime)) {
    if (file.size > budget) throw new AttachmentError("That video is too large to text (the limit is about 2.8 MB). Try a shorter clip.");
    const dataUrl = await blobToDataUrl(new Blob([file], { type: mime }));
    return { id: uid(), dataUrl, kind: "video", contentType: mime, previewUrl: URL.createObjectURL(file), name: file.name, bytes: file.size };
  }

  if (AUDIO_TYPES.includes(mime) || mime.startsWith("audio/")) {
    if (file.size > budget) throw new AttachmentError("That audio file is too large to text (the limit is about 2.8 MB).");
    const dataUrl = await blobToDataUrl(new Blob([file], { type: mime }));
    return { id: uid(), dataUrl, kind: "audio", contentType: mime, previewUrl: URL.createObjectURL(file), name: file.name, bytes: file.size };
  }

  if (mime === "application/pdf" || mime === "text/vcard" || mime === "text/x-vcard") {
    if (file.size > budget) throw new AttachmentError("That file is too large to text (the limit is about 2.8 MB).");
    const dataUrl = await blobToDataUrl(new Blob([file], { type: mime }));
    return { id: uid(), dataUrl, kind: "other", contentType: mime, previewUrl: URL.createObjectURL(file), name: file.name, bytes: file.size };
  }

  throw new AttachmentError("That kind of file cannot be texted. Photos, GIFs, short videos, audio, PDF and contact cards can.");
}

/** Prepares several files, sharing the size allowance between them. */
export async function prepareAttachments(files: File[], already: PreparedAttachment[]): Promise<{ ready: PreparedAttachment[]; errors: string[] }> {
  const room = Math.max(0, MAX_FILES - already.length);
  const picked = files.slice(0, room);
  const errors: string[] = [];
  if (files.length > room) errors.push(`Only ${MAX_FILES} files can be attached to one text.`);

  let used = already.reduce((n, a) => n + a.bytes, 0);
  const ready: PreparedAttachment[] = [];
  for (let i = 0; i < picked.length; i++) {
    const remainingFiles = picked.length - i;
    const budget = Math.floor((MAX_TOTAL_BYTES - used) / remainingFiles);
    if (budget < 30 * 1024) {
      errors.push("There is no room left for that file. Send these first, then attach more.");
      break;
    }
    try {
      const a = await prepareAttachment(picked[i], budget);
      used += a.bytes;
      ready.push(a);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Could not use that file.");
    }
  }
  return { ready, errors };
}

export function mediaKindLabel(a: { kind: MediaKind; contentType: string }): string {
  if (a.kind === "image") return a.contentType === "image/gif" ? "GIF" : "Photo";
  if (a.kind === "video") return "Video";
  if (a.kind === "audio") return "Audio";
  return a.contentType === "application/pdf" ? "PDF document" : "Contact card";
}
