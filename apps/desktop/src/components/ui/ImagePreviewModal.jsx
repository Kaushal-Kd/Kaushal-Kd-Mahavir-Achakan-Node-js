import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { useUIStore } from '../../stores/uiStore.js';

const ImagePreviewModal = () => {
  const preview = useUIStore((s) => s.imagePreview);
  const closeImagePreview = useUIStore((s) => s.closeImagePreview);

  useEffect(() => {
    if (!preview) return undefined;
    const onKey = (e) => e.key === 'Escape' && closeImagePreview();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [preview, closeImagePreview]);

  if (!preview?.src) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={preview.alt || 'Image preview'}
    >
      <button
        type="button"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-gray-900/80"
        onClick={closeImagePreview}
        aria-label="Close image preview"
      />
      <button
        type="button"
        onClick={closeImagePreview}
        className="absolute right-4 top-4 z-10 rounded border border-gray-200 bg-surface p-2 text-gray-700 hover:bg-gray-50"
        aria-label="Close preview"
      >
        <X size={20} />
      </button>
      <img
        src={preview.src}
        alt={preview.alt || ''}
        className="relative z-10 max-h-[90vh] max-w-[min(90vw,1200px)] object-contain"
      />
    </div>,
    document.body
  );
};

export default ImagePreviewModal;
