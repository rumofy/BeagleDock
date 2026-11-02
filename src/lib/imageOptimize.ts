// Imagens coladas ou anexadas são otimizadas antes de ir para a CLI e para o histórico:
// redimensiona se passar do maior lado que os modelos aproveitam e recomprime em WebP.
// GIF fica como está (pode ser animado); se a versão nova não for menor, vale a original.

/** Maior lado aproveitado pelos modelos de visão atuais; acima disso a própria API reduz. */
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

/** Nome com a extensão do formato novo (`print.png` → `print.webp`). */
export function webpName(name: string) {
  return /\.[^./]+$/.test(name) ? name.replace(/\.[^./]+$/, ".webp") : `${name}.webp`;
}

export const canOptimize = (type: string) => OPTIMIZABLE.has(type);

/** Versão otimizada da imagem, ou `null` quando não compensa (ou o navegador não consegue). */
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
