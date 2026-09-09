import { imageCrop } from '../stores/uiStore.js';
import { shouldSkipImageCrop } from '../utils/cropImage.js';

export const IMAGE_UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/** Target ceiling after compression / before signed URL. */
export const IMAGE_UPLOAD_MAX_KB = 700;

/** Allow large phone photos; they are compressed before upload. */
export const IMAGE_UPLOAD_PICK_MAX_KB = 25_600;

/**
 * Validate and optionally crop a single image before upload.
 * Large originals are allowed here; size is enforced after compression in uploadToGCS.
 *
 * @param {File} file
 * @param {{ aspect?: number, title?: string, maxKb?: number }} [options]
 * @returns {Promise<File>}
 */
export async function prepareSingleImageForUpload(file, options = {}) {
  if (!file) throw new Error('No file provided');

  if (!file.type?.startsWith('image/')) {
    throw new Error('Please pick an image file');
  }

  const pickMaxKb = Number(options.maxKb) > 0 ? Number(options.maxKb) : IMAGE_UPLOAD_PICK_MAX_KB;
  if (file.size > pickMaxKb * 1024) {
    throw new Error(`Original image must be under ${pickMaxKb.toLocaleString('en-IN')} KB`);
  }

  if (shouldSkipImageCrop(file)) {
    return file;
  }

  try {
    return await imageCrop.request(file, {
      aspect: options.aspect,
      title: options.title || 'Crop image',
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    throw err;
  }
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isImageCropCancelled(err) {
  return err?.name === 'AbortError';
}
