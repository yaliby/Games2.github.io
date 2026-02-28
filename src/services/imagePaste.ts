const MAX_IMAGE_DATA_URL_CHARS = 620_000;
const MAX_IMAGE_DIMENSION = 1280;

function isImageMime(type: string): boolean {
  return /^image\/(png|jpe?g|webp|gif)$/i.test(type);
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("image-read-failed"));
      }
    };
    reader.onerror = () => reject(new Error("image-read-failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image-decode-failed"));
    image.src = dataUrl;
  });
}

function encodeCanvas(
  image: HTMLImageElement,
  width: number,
  height: number,
  mimeType: string,
  quality?: number
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas-not-supported");
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL(mimeType, quality);
}

export function pickImageFileFromClipboard(data: DataTransfer | null): File | null {
  if (!data?.items) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    if (!isImageMime(file.type)) continue;
    return file;
  }
  return null;
}

export function looksLikeInlineImageDataUrl(value: string): boolean {
  return /^data:image\/(png|jpe?g|webp);base64,/i.test(value);
}

export async function compressImageFileToDataUrl(file: File): Promise<string> {
  if (!isImageMime(file.type)) {
    throw new Error("not-image");
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  if (originalDataUrl.length <= MAX_IMAGE_DATA_URL_CHARS && looksLikeInlineImageDataUrl(originalDataUrl)) {
    return originalDataUrl;
  }

  const image = await loadImage(originalDataUrl);
  const sourceWidth = Math.max(1, image.naturalWidth || image.width);
  const sourceHeight = Math.max(1, image.naturalHeight || image.height);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight));
  let width = Math.max(1, Math.round(sourceWidth * scale));
  let height = Math.max(1, Math.round(sourceHeight * scale));

  const tries: Array<{ mime: "image/webp" | "image/jpeg"; quality: number }> = [
    { mime: "image/webp", quality: 0.88 },
    { mime: "image/webp", quality: 0.78 },
    { mime: "image/webp", quality: 0.68 },
    { mime: "image/jpeg", quality: 0.8 },
    { mime: "image/jpeg", quality: 0.68 },
    { mime: "image/jpeg", quality: 0.58 },
  ];

  for (let shrinkStep = 0; shrinkStep < 5; shrinkStep += 1) {
    for (const option of tries) {
      const dataUrl = encodeCanvas(image, width, height, option.mime, option.quality);
      if (dataUrl.length <= MAX_IMAGE_DATA_URL_CHARS) {
        return dataUrl;
      }
    }

    width = Math.max(1, Math.round(width * 0.85));
    height = Math.max(1, Math.round(height * 0.85));
  }

  throw new Error("image-too-large");
}
