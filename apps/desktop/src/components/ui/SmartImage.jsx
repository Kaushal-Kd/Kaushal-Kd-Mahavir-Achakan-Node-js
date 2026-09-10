import { thumbUrlForImage } from '@wrs/shared';
import { ImageOff } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import { imagePreview } from '../../stores/uiStore.js';

const SmartImage = ({
  src = '',
  alt = '',
  className = '',
  fallback = null,
  previewable = true,
  variant = 'thumb',
}) => {
  const original = String(src ?? '').trim();
  const preferred = useMemo(() => {
    if (!original) return '';
    if (variant === 'full') return original;
    return thumbUrlForImage(original) || original;
  }, [original, variant]);

  const [activeSrc, setActiveSrc] = useState(preferred);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setActiveSrc(preferred);
    setErr(false);
  }, [preferred, original]);

  if (!original || err) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-50 text-gray-300 ${className || ''}`}
        aria-label={alt || 'image not available'}
      >
        {fallback || <ImageOff size={20} />}
      </div>
    );
  }

  const handleError = () => {
    if (activeSrc && original && activeSrc !== original) {
      setActiveSrc(original);
      return;
    }
    setErr(true);
  };

  const img = (
    <img
      src={activeSrc}
      alt={alt || ''}
      className={className}
      loading="lazy"
      decoding="async"
      onError={handleError}
    />
  );

  if (!previewable) {
    return img;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        imagePreview.open(original, alt);
      }}
      className={`inline-block shrink-0 border-0 bg-transparent p-0 cursor-zoom-in ${className || ''}`}
      title="View larger"
      aria-label={alt ? `View larger: ${alt}` : 'View larger image'}
    >
      {img}
    </button>
  );
};

SmartImage.propTypes = {
  src: PropTypes.string,
  alt: PropTypes.string,
  className: PropTypes.string,
  fallback: PropTypes.node,
  previewable: PropTypes.bool,
  variant: PropTypes.oneOf(['thumb', 'full']),
};

export default SmartImage;
