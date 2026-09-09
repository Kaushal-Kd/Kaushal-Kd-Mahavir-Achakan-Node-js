import { ZoomIn } from 'lucide-react';
import PropTypes from 'prop-types';

import { imagePreview } from '../../stores/uiStore.js';

/**
 * Image inside an upload pick button — single-click still handled by parent.
 * Double-click or zoom icon opens the global image preview.
 */
const PreviewableUploadThumb = ({
  src,
  alt = '',
  className = 'h-full w-full object-cover',
}) => {
  const url = String(src ?? '').trim();
  if (!url) return null;

  const openPreview = (e) => {
    e.preventDefault();
    e.stopPropagation();
    imagePreview.open(url, alt);
  };

  return (
    <>
      <img
        src={url}
        alt={alt || ''}
        className={className}
        onDoubleClick={openPreview}
      />
      <button
        type="button"
        onClick={openPreview}
        className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded border border-gray-200 bg-surface text-brand shadow-sm hover:bg-gray-50"
        title="View larger"
        aria-label="View larger image"
      >
        <ZoomIn size={14} />
      </button>
    </>
  );
};

PreviewableUploadThumb.propTypes = {
  src: PropTypes.string.isRequired,
  alt: PropTypes.string,
  className: PropTypes.string,
};

export default PreviewableUploadThumb;
