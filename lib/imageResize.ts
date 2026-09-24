"use client";

// Shrinks a picked photo before it is sent: picture messages have a small
// size budget, and a phone photo is often 5 MB or more.

const MAX_SIDE = 1600;

export interface PreparedImage {
  dataUrl: string;
  /** A small local URL for showing the picture straight away. */
  previewUrl: string;
  width: number;
  height: number;
}

export async function prepareImage(file: File, budget = 1.8 * 1024 * 1024): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose a picture.");
  if (file.size > 40 * 1024 * 1024) throw new Error("That picture is too large.");

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that picture. Try a JPEG or PNG."));
      el.src = url;
    });

    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process the picture.");
    // JPEG has no transparency, so a transparent PNG would turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    // Steps quality down until it fits comfortably under the upload cap.
    let dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    for (const q of [0.7, 0.58, 0.45, 0.35]) {
      if (dataUrl.length * 0.75 <= budget) break;
      dataUrl = canvas.toDataURL("image/jpeg", q);
    }
    // Still too big at the lowest quality: scale it down and try again.
    for (const f of [0.75, 0.55, 0.4]) {
      if (dataUrl.length * 0.75 <= budget) break;
      canvas.width = Math.max(1, Math.round(width * f));
      canvas.height = Math.max(1, Math.round(height * f));
      const c2 = canvas.getContext("2d")!;
      c2.fillStyle = "#ffffff";
      c2.fillRect(0, 0, canvas.width, canvas.height);
      c2.drawImage(img, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL("image/jpeg", 0.5);
    }
    if (dataUrl.length * 0.75 > budget) throw new Error("That picture is too large to send.");
    return { dataUrl, previewUrl: dataUrl, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
