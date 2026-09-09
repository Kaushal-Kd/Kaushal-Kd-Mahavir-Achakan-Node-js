import { MAX_DIMENSION } from './compressImage.js';

/** Formats where re-cropping would break content or add little benefit. */
export const SKIP_CROP_TYPES = new Set(['image/gif', 'image/svg+xml']);

/**
 * Scale factor that keeps the longest edge within MAX_DIMENSION.
 * Cropping used to emit a canvas at the full source resolution, so a 12 MP
 * photo produced a ~10 MP blob that compression then had to claw back down.
 * Capping here means compression starts from an already-sane image.
 *
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
function fitScale(width, height) {
  const longest = Math.max(width, height, 1);
  return Math.min(1, MAX_DIMENSION / longest);
}

function getRadianAngle(degreeValue) {
  return (degreeValue * Math.PI) / 180;
}

function rotateSize(width, height, rotation) {
  const rotRad = getRadianAngle(rotation);
  return {
    width: Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height: Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  };
}

/**
 * @param {File|Blob} file
 * @returns {boolean}
 */
export function shouldSkipImageCrop(file) {
  if (!file?.type?.startsWith('image/')) return true;
  return SKIP_CROP_TYPES.has(file.type);
}

/**
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

/**
 * @param {string} mimeType
 * @returns {string}
 */
export function outputMimeForCrop(mimeType) {
  if (mimeType === 'image/webp') return 'image/webp';
  if (mimeType === 'image/png') return 'image/png';
  return 'image/jpeg';
}

function normalizeRotation(rotation) {
  return ((Math.round(rotation) % 360) + 360) % 360;
}

function canvasToBlob(canvas, mimeType, quality) {
  const outMime = outputMimeForCrop(mimeType);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Could not export image'));
        else resolve(blob);
      },
      outMime,
      outMime === 'image/jpeg' || outMime === 'image/webp' ? quality : undefined
    );
  });
}

/**
 * Rotate full image to a blob (for live preview in crop modal).
 * @param {string} imageSrc
 * @param {number} rotation degrees
 * @param {string} [mimeType]
 * @param {number} [quality]
 * @returns {Promise<Blob>}
 */
export async function getRotatedImageBlob(
  imageSrc,
  rotation,
  mimeType = 'image/jpeg',
  quality = 0.85
) {
  const deg = normalizeRotation(rotation);
  const image = await loadImageFromUrl(imageSrc);
  if (deg === 0) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.drawImage(image, 0, 0);
    return canvasToBlob(canvas, mimeType, quality);
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  const rotRad = getRadianAngle(deg);
  const { width: bBoxWidth, height: bBoxHeight } = rotateSize(
    image.naturalWidth,
    image.naturalHeight,
    deg
  );

  canvas.width = bBoxWidth;
  canvas.height = bBoxHeight;

  ctx.translate(bBoxWidth / 2, bBoxHeight / 2);
  ctx.rotate(rotRad);
  ctx.translate(-image.naturalWidth / 2, -image.naturalHeight / 2);
  ctx.drawImage(image, 0, 0);

  return canvasToBlob(canvas, mimeType, quality);
}

/**
 * Export cropped region from imageSrc (crop pixels match imageSrc orientation).
 *
 * @param {{
 *   imageSrc: string,
 *   cropPixels: { x: number, y: number, width: number, height: number },
 *   mimeType?: string,
 *   quality?: number,
 * }} params
 * @returns {Promise<Blob>}
 */
export async function getCroppedImageBlob({
  imageSrc,
  cropPixels,
  mimeType = 'image/jpeg',
  quality = 0.85,
}) {
  const image = await loadImageFromUrl(imageSrc);

  const croppedCanvas = document.createElement('canvas');
  const croppedCtx = croppedCanvas.getContext('2d');
  if (!croppedCtx) throw new Error('Canvas not supported');

  const scale = fitScale(cropPixels.width, cropPixels.height);
  croppedCanvas.width = Math.max(1, Math.floor(cropPixels.width * scale));
  croppedCanvas.height = Math.max(1, Math.floor(cropPixels.height * scale));

  croppedCtx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    croppedCanvas.width,
    croppedCanvas.height
  );

  return canvasToBlob(croppedCanvas, mimeType, quality);
}

/**
 * @param {Blob} blob
 * @param {File|Blob} sourceFile
 * @returns {File}
 */
export function blobToImageFile(blob, sourceFile) {
  const base = sourceFile instanceof File ? sourceFile.name.replace(/\.[^.]+$/, '') : 'image';
  const ext =
    blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
  return new File([blob], `${base}-cropped.${ext}`, {
    type: blob.type || 'image/jpeg',
    lastModified: Date.now(),
  });
}
