import { ExternalLink, FileText, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import PropTypes from 'prop-types';
import { useRef, useState } from 'react';

import { uploadToGCS } from '../../services/gcsUpload.js';
import {
  IMAGE_UPLOAD_ACCEPT,
  isImageCropCancelled,
  prepareSingleImageForUpload,
} from '../../services/imagePickWithCrop.js';
import { processImageUploadBatch } from '../../services/multiImageUploadBatch.js';
import {
  PDF_MIME,
  isAcceptedUploadAttachment,
  isPdfAttachment,
  isPdfAttachmentUrl,
  prepareUploadAttachment,
} from '../../services/uploadAttachment.js';
import { toast } from '../../stores/uiStore.js';

import Button from './Button.jsx';
import PreviewableUploadThumb from './PreviewableUploadThumb.jsx';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const UPLOAD_WORKERS = 2;

async function uploadPreparedFiles(files, folder, allowPdf, onProgress) {
  const { uploaded, failed, skipped } = await processImageUploadBatch(files, {
    prepareFile: (file) => prepareUploadAttachment(file, {
      allowPdf, prepareImage: prepareSingleImageForUpload,
    }),
    uploadFile: async (file) => {
      const { publicUrl } = await uploadToGCS(file, {
        folder,
        compress: !isPdfAttachment(file),
      });
      return publicUrl;
    },
    isPreparationCancelled: isImageCropCancelled,
    maxFileBytes: MAX_FILE_BYTES,
    workerCount: UPLOAD_WORKERS,
    onProgress,
  });
  if (skipped > 0) {
    toast.warning(`${skipped} attachment${skipped > 1 ? 's' : ''} over 25,600 KB skipped`);
  }
  if (failed > 0) toast.error(`${failed} attachment${failed > 1 ? 's' : ''} failed validation or upload`);
  return uploaded;
}

/**
 * Multiple image URLs with GCS upload (same pipeline as ImageUploader).
 */
const MultiImageUploader = ({
  value = [],
  onChange,
  folder = 'misc',
  label = null,
  hint = null,
  maxImages = 20,
  disabled = false,
  allowPdf = false,
}) => {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const urls = Array.isArray(value) ? value.filter(Boolean) : [];
  const slotsLeft = Math.max(0, maxImages - urls.length);

  const onPick = () => {
    if (disabled || busy || slotsLeft <= 0) return;
    inputRef.current?.click();
  };

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    const picked = files.filter((file) => isAcceptedUploadAttachment(file, allowPdf));
    e.target.value = '';
    if (disabled || busy) return;
    if (picked.length < files.length) toast.warning(allowPdf ? 'Choose image or PDF attachments' : 'Choose image files');
    if (!picked.length) return;
    if (slotsLeft <= 0) {
      toast.warning(`Maximum ${maxImages} ${allowPdf ? 'attachments' : 'images'}`);
      return;
    }

    const batch = picked.slice(0, slotsLeft);
    setBusy(true);
    try {
      const uploaded = await uploadPreparedFiles(batch, folder, allowPdf);
      if (uploaded.length) onChange([...urls, ...uploaded]);
    } finally {
      setBusy(false);
    }
  };

  const removeAt = (index) => {
    onChange(urls.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {label ? <p className="label">{label}</p> : null}
      {hint ? <p className="text-[11px] text-gray-500">{hint}</p> : null}
      <div className="flex flex-wrap gap-2">
        {urls.map((url, index) => {
          const pdf = isPdfAttachmentUrl(url);
          return (
            <div key={`${url}-${index}`} className="relative h-20 w-20">
              {pdf ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 bg-gray-50 text-gray-500">
                  <FileText className="h-7 w-7 text-brand" />
                  <span className="text-[10px] font-medium">PDF bill</span>
                </div>
              ) : (
                <PreviewableUploadThumb
                  src={url}
                  alt="Purchase bill attachment"
                  className="h-20 w-20 rounded-lg border border-gray-200 object-cover"
                />
              )}
              <div className="pointer-events-none absolute right-1 top-1 z-20 flex flex-col gap-1">
                {pdf ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded border border-gray-200 bg-white text-brand shadow-sm hover:bg-gray-50"
                    title="Open PDF"
                    aria-label="Open PDF attachment"
                  >
                    <ExternalLink size={14} />
                  </a>
                ) : null}
                <button
                  type="button"
                  className={`${pdf ? '' : 'mt-7'} pointer-events-auto flex h-6 w-6 items-center justify-center rounded border border-gray-200 bg-white text-red-600 shadow-sm hover:bg-red-50`}
                  onClick={() => removeAt(index)}
                  disabled={disabled || busy}
                  aria-label={`Remove ${pdf ? 'PDF' : 'image'}`}
                  title={`Remove ${pdf ? 'PDF' : 'image'}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
        {slotsLeft > 0 ? (
          <button
            type="button"
            onClick={onPick}
            disabled={disabled || busy}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 text-gray-500 hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <ImagePlus className="h-5 w-5" />
                <span className="text-[10px]">Add</span>
              </>
            )}
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={allowPdf ? `${IMAGE_UPLOAD_ACCEPT},${PDF_MIME}` : IMAGE_UPLOAD_ACCEPT}
        multiple
        className="hidden"
        onChange={onFiles}
      />
      {urls.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange([])}
          disabled={disabled || busy}
        >
          Clear all
        </Button>
      ) : null}
    </div>
  );
};

MultiImageUploader.propTypes = {
  value: PropTypes.arrayOf(PropTypes.string),
  onChange: PropTypes.func.isRequired,
  folder: PropTypes.string,
  label: PropTypes.string,
  hint: PropTypes.string,
  maxImages: PropTypes.number,
  disabled: PropTypes.bool,
  allowPdf: PropTypes.bool,
};

export default MultiImageUploader;
