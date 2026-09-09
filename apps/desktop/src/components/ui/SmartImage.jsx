import { ImageOff } from 'lucide-react';
import PropTypes from 'prop-types';
import { useState } from 'react';

import { imagePreview } from '../../stores/uiStore.js';

const SmartImage = ({
  src = '',
  alt = '',
  className = '',
  fallback = null,
  previewable = true,
}) => {
  const [err, setErr] = useState(false);
  const url = String(src ?? '').trim();

  if (!url || err) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-50 text-gray-300 ${className || ''}`}
        aria-label={alt || 'image not available'}
      >
        {fallback || <ImageOff size={20} />}
      </div>
    );
  }

  const img = (
    <img
      src={url}
      alt={alt || ''}
      className={className}
      loading="lazy"
      onError={() => setErr(true)}
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
        imagePreview.open(url, alt);
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
};

export default SmartImage;
