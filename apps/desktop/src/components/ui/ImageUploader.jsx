import { ImagePlus, Loader2, Trash2, User } from 'lucide-react';
import PropTypes from 'prop-types';
import { useRef, useState } from 'react';

import { uploadToGCS } from '../../services/gcsUpload.js';
import {
  IMAGE_UPLOAD_ACCEPT,
  IMAGE_UPLOAD_PICK_MAX_KB,
  isImageCropCancelled,
  prepareSingleImageForUpload,
} from '../../services/imagePickWithCrop.js';
import { toast } from '../../stores/uiStore.js';

import Button from './Button.jsx';
import PreviewableUploadThumb from './PreviewableUploadThumb.jsx';

const ACCEPT = IMAGE_UPLOAD_ACCEPT;
const PICK_MAX_KB = IMAGE_UPLOAD_PICK_MAX_KB;

/**
 * Square image uploader that pushes bytes straight to Google Cloud Storage
 * via a signed URL (`services/gcsUpload.js`) and returns the resulting
 * `publicUrl` to the parent through `onChange`.
 *
 *   <ImageUploader
 *     value={form.logo_url}
 *     onChange={(url) => set('logo_url', url)}
 *     folder="shop-logos"
 *     label="Shop logo"
 *     shape="square"
 *   />
 */
const ImageUploader = ({
  value = '',
  onChange,
  folder = 'misc',
  label = null,
  hint = null,
  shape = 'square',
  size = 'lg',
  placeholder = null,
  disabled = false,
  skipCrop = false,
}) => {
  const inputRef = useRef(null);
  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState(false);

  const sizeClass = {
    sm: 'h-16 w-16',
    md: 'h-24 w-24',
    lg: 'h-32 w-32',
    xl: 'h-40 w-40',
  }[size || 'lg'];

  const radiusClass = shape === 'circle' ? 'rounded-full' : 'rounded-lg';

  const onPick = () => {
    if (disabled || busy) return;
    inputRef.current?.click();
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    let uploadFile = file;
    if (!skipCrop) {
      try {
        uploadFile = await prepareSingleImageForUpload(file, {
          aspect: shape === 'circle' ? 1 : undefined,
          title: typeof label === 'string' && label ? `Crop ${label.toLowerCase()}` : 'Crop image',
        });
      } catch (err) {
        if (isImageCropCancelled(err)) return;
        toast.error(err?.message || 'Could not prepare image');
        return;
      }
    } else if (!file.type?.startsWith('image/')) {
      toast.error('Please pick an image file');
      return;
    } else if (file.size > PICK_MAX_KB * 1024) {
      toast.error(`Original image must be under ${PICK_MAX_KB.toLocaleString('en-IN')} KB`);
      return;
    }

    setBusy(true);
    setPct(0);
    try {
      const { publicUrl } = await uploadToGCS(uploadFile, {
        folder,
        onProgress: setPct,
      });
      onChange?.(publicUrl);
      toast.success('Image uploaded');
    } catch (err) {
      const msg = err?.response?.data?.error?.message || err?.message || 'Upload failed';
      toast.error(msg);
    } finally {
      setBusy(false);
      setPct(0);
    }
  };

  const onRemove = () => {
    if (disabled || busy) return;
    onChange?.('');
  };

  const hasImage = !!value;

  return (
    <div className="space-y-2">
      {label ? <div className="label">{label}</div> : null}
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onPick}
          disabled={disabled || busy}
          className={[
            sizeClass,
            radiusClass,
            'relative overflow-hidden border border-dashed border-gray-300 bg-gray-50',
            'flex items-center justify-center text-gray-400',
            disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-brand hover:text-brand',
            'transition-colors',
          ].join(' ')}
          aria-label={hasImage ? 'Change image' : 'Upload image'}
        >
          {hasImage ? (
            <PreviewableUploadThumb
              src={value}
              alt={typeof label === 'string' ? label : 'Uploaded image'}
              className="h-full w-full object-cover"
            />
          ) : (
            placeholder || <ImagePlus size={24} />
          )}
          {busy ? (
            <div
              className={`absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 text-white ${radiusClass}`}
            >
              <Loader2 size={18} className="animate-spin" />
              <span className="text-[10px] font-medium">{pct}%</span>
            </div>
          ) : null}
        </button>

        <div className="flex flex-col gap-1.5">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={onFile}
            disabled={disabled || busy}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={ImagePlus}
            onClick={onPick}
            disabled={disabled || busy}
          >
            {hasImage ? 'Replace' : 'Upload'}
          </Button>
          {hasImage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={Trash2}
              onClick={onRemove}
              disabled={disabled || busy}
              className="text-red-600 hover:bg-red-50"
            >
              Remove
            </Button>
          ) : null}
          {hint ? <div className="text-xs text-gray-500">{hint}</div> : null}
        </div>
      </div>
    </div>
  );
};

ImageUploader.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  folder: PropTypes.string,
  label: PropTypes.node,
  hint: PropTypes.node,
  shape: PropTypes.oneOf(['square', 'circle']),
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl']),
  placeholder: PropTypes.node,
  disabled: PropTypes.bool,
  skipCrop: PropTypes.bool,
};

/** Preset for user avatars — circle + user icon placeholder */
export const AvatarUploader = (props) => (
  <ImageUploader shape="circle" placeholder={<User size={24} />} folder="avatars" {...props} />
);

export default ImageUploader;
