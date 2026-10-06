import type { ImageInput } from "../../lib/steps/vision";

export interface Photo extends ImageInput {
  /** data: URL for the preview */
  url: string;
}

const MAX_SIDE = 1600;

function fromCanvas(canvas: HTMLCanvasElement): Photo {
  const url = canvas.toDataURL("image/jpeg", 0.9);
  return { url, data: url.slice(url.indexOf(",") + 1), mediaType: "image/jpeg" };
}

function scaled(w: number, h: number) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Downscales an image file to a JPEG small enough to send to a model. */
export async function photoFromBlob(blob: Blob): Promise<Photo> {
  const src = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const { w, h } = scaled(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    // white under transparent PNGs, so the model doesn't see black on black
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return fromCanvas(canvas);
  } finally {
    URL.revokeObjectURL(src);
  }
}

export function photoFromVideo(video: HTMLVideoElement): Photo {
  const { w, h } = scaled(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
  return fromCanvas(canvas);
}

export function imageFromClipboard(e: { clipboardData: DataTransfer | null }): File | null {
  const items = e.clipboardData?.items;
  if (!items) return null;
  for (const it of Array.from(items)) {
    if (it.kind === "file" && it.type.startsWith("image/")) return it.getAsFile();
  }
  return null;
}
