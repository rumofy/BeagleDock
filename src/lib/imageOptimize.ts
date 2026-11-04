// Pasted or attached images are optimized before going to the CLI and the history: resized when
// larger than the longest side the models use, and re-encoded as WebP. A GIF stays as is (it may
// be animated); if the new version isn't smaller, the original is kept.

/** Longest side current vision models use; above it the API itself scales the image down. */
export const MAX_IMAGE_EDGE = 2576;
export const WEBP_QUALITY = 0.9;
const OPTIMIZABLE = new Set(["image/png", "image/jpeg", "image/webp", "image/bmp"]);

export function fitWithin(width: number, height: number, max = MAX_IMAGE_EDGE) {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height, resized: false };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

/** Name with the new format's extension (`print.png` → `print.webp`). */
export function webpName(name: string) {
  return /\.[^./]+$/.test(name) ? name.replace(/\.[^./]+$/, ".webp") : `${name}.webp`;
}

export const canOptimize = (type: string) => OPTIMIZABLE.has(type);

/** Optimized version of the image, or `null` when it isn't worth it (or the browser can't). */
export async function optimizeImage(file: Blob): Promise<Blob | null> {
  if (!canOptimize(file.type) || typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const target = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", WEBP_QUALITY),
    );
    if (!blob || blob.type !== "image/webp") return null;
    return blob.size < file.size || target.resized ? blob : null;
  } catch {
    return null;
  }
}
