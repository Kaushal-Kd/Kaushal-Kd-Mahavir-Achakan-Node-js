import imageCompression from 'browser-image-compression';

/** Skip formats where re-encoding would break content or add little benefit. */
const SKIP_TYPES = new Set(['image/gif', 'image/svg+xml']);

/** Formats that must never be re-encoded to JPEG. */
const KEEP_TYPE = new Set(['image/gif', 'image/svg+xml']);

/** Already-small files are not worth re-encoding. */
const SKIP_IF_UNDER_BYTES = 120 * 1024;

/** Catalog-friendly max edge — sharp on desktop, much smaller upload. */
export const MAX_DIMENSION = 1920;

/** Good visual quality with smaller files for phone photos. */
const OUTPUT_QUALITY = 0.88;

/** Target ceiling after compression; larger photos normally finish around 500-700 KB. */
export const TARGET_IMAGE_MAX_KB = 700;

/**
 * Does this image actually use its alpha channel?
 *
 * A photographic PNG is usually fully opaque, and keeping it as PNG is what
 * makes uploads stay multi-MB: PNG re-encoding barely shrinks a photo, so the
 * "compressed" result comes out larger than the source and gets discarded.
 * Converting those to JPEG is the single biggest win here. PNGs that really
 * are transparent (logos, cut-outs) still round-trip as PNG.
 *
 * @param {File|Blob} file
 * @returns {Promise<boolean>}
 */
async function hasTransparency(file) {
  let url;
  try {
    url = URL.createObjectURL(file);
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });

    // Read at native resolution. Downsampling first would average a small
    // transparent region against its opaque neighbours until it looked solid,
    // and a false "opaque" here means re-encoding to JPEG and turning those
    // pixels black — worse than simply keeping the PNG.
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, image.naturalWidth || image.width);
    canvas.height = Math.max(1, image.naturalHeight || image.height);

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return true;
    ctx.drawImage(image, 0, 0);

    // Scan in horizontal bands so a very large image doesn't need one giant
    // ImageData allocation.
    const BAND = 256;
    for (let y = 0; y < canvas.height; y += BAND) {
      const h = Math.min(BAND, canvas.height - y);
      const { data } = ctx.getImageData(0, y, canvas.width, h);
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) return true;
      }
    }
    return false;
  } catch {
    // Probe failed (tainted canvas, decode error) — assume transparency and
    // keep the original format rather than risk a black background.
    return true;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

/**
 * Compress an image file in the browser before upload.
 * Downscales large photos and re-encodes to a catalog-friendly size.
 *
 * @param {File|Blob} file
 * @param {{ onProgress?: (pct: number) => void }} [options]
 * @returns {Promise<File|Blob>}
 */
export async function compressImageFile(file, options = {}) {
  if (!file?.type?.startsWith('image/')) return file;
  if (SKIP_TYPES.has(file.type)) return file;
  if (file.size <= SKIP_IF_UNDER_BYTES) return file;

  let forceJpeg = !KEEP_TYPE.has(file.type);
  if (forceJpeg && file.type === 'image/png') {
    forceJpeg = !(await hasTransparency(file));
  }

  try {
    const compressed = await imageCompression(file, {
      maxWidthOrHeight: MAX_DIMENSION,
      initialQuality: OUTPUT_QUALITY,
      maxSizeMB: TARGET_IMAGE_MAX_KB / 1024,
      useWebWorker: true,
      preserveExif: false,
      ...(forceJpeg ? { fileType: 'image/jpeg' } : {}),
      onProgress: options.onProgress,
    });

    if (!compressed || compressed.size >= file.size) return file;
    return compressed;
  } catch {
    return file;
  }
}
