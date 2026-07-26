/**
 * Client-side avatar compression for profile photos.
 */

const MAX_EDGE = 256;
const JPEG_QUALITY = 0.82;
const MAX_BYTES = 120_000;

/**
 * @param {File | Blob} file
 * @returns {Promise<{ dataUrl: string, blob: Blob }>}
 */
export async function compressAvatar(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw Object.assign(new Error("Choose an image file (JPG, PNG, or WebP)."), {
      code: "bad_type",
    });
  }
  if (file.size > 8 * 1024 * 1024) {
    throw Object.assign(new Error("Image is too large (max 8 MB)."), { code: "too_large" });
  }

  const bitmap = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (typeof bitmap.close === "function") bitmap.close();

  let quality = JPEG_QUALITY;
  let blob = await canvasToBlob(canvas, "image/jpeg", quality);
  while (blob.size > MAX_BYTES && quality > 0.45) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, "image/jpeg", quality);
  }
  if (blob.size > MAX_BYTES) {
    throw Object.assign(new Error("Couldn’t compress that image enough. Try a simpler photo."), {
      code: "too_large",
    });
  }

  const dataUrl = await blobToDataUrl(blob);
  return { dataUrl, blob };
}

function loadImage(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn’t read that image."));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image."))),
      type,
      quality
    );
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image data."));
    reader.readAsDataURL(blob);
  });
}

/** Single-letter fallback from username (logo-style avatar). */
export function avatarInitials(account) {
  const raw = String(account?.username || account?.displayName || account?.name || account?.email || "?");
  const cleaned = raw.replace(/^@/, "").trim();
  if (!cleaned) return "?";
  const letter = cleaned.match(/[A-Za-z0-9]/)?.[0] || cleaned[0];
  return String(letter).toUpperCase();
}
