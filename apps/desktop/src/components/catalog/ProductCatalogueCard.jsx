import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageOff, Upload } from 'lucide-react';
import PropTypes from 'prop-types';
import { useRef } from 'react';

import Button from '../ui/Button.jsx';
import SmartImage from '../ui/SmartImage.jsx';
import { productsApi } from '../../lib/api/products.js';
import { invalidateCatalogDomain } from '../../lib/queryInvalidation.js';
import {
  isImageCropCancelled,
  prepareSingleImageForUpload,
} from '../../services/imagePickWithCrop.js';
import { uploadToGCS } from '../../services/gcsUpload.js';
import { toast } from '../../stores/uiStore.js';

function formatCatalogueCode(product) {
  const code = String(product?.code || '').trim();
  const size = String(product?.size || '').trim();
  if (!code) return '—';
  if (!size || code.includes(`[${size}]`)) return code;
  return `${code} [${size}]`;
}

const NoImageFallback = () => (
  <div className="flex flex-col items-center justify-center gap-2 text-gray-400 px-2 text-center">
    <ImageOff size={28} strokeWidth={1.25} />
    <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
      No Image Available
    </span>
  </div>
);

const ProductCatalogueCard = ({ product, uploading, onUploadStart, onUploadEnd }) => {
  const queryClient = useQueryClient();
  const inputRef = useRef(null);

  const updateMutation = useMutation({
    mutationFn: (main_image) => productsApi.update(product.id, { main_image }),
    onSuccess: async () => {
      toast.success('Product image updated');
      await invalidateCatalogDomain(queryClient, { productId: product.id });
      onUploadEnd?.();
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to save image');
      onUploadEnd?.();
    },
  });

  const handleFile = async (file) => {
    if (!file) return;
    onUploadStart?.(product.id);
    let uploadFile = file;
    try {
      uploadFile = await prepareSingleImageForUpload(file, { title: 'Crop product photo' });
    } catch (err) {
      if (isImageCropCancelled(err)) {
        onUploadEnd?.();
        return;
      }
      toast.error(err?.message || 'Could not prepare image');
      onUploadEnd?.();
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    try {
      const { publicUrl } = await uploadToGCS(uploadFile, { folder: 'products' });
      await updateMutation.mutateAsync(publicUrl);
    } catch (err) {
      toast.error(err?.message || 'Failed to upload image');
      onUploadEnd?.();
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const busy = uploading || updateMutation.isPending;

  return (
    <div className="card p-2 flex flex-col border border-gray-200 bg-white">
      <SmartImage
        src={product.main_image}
        alt={product.name}
        previewable={Boolean(product.main_image)}
        fallback={<NoImageFallback />}
        className="w-full aspect-[4/3] rounded border border-gray-200 object-contain bg-gray-50 mb-2"
      />
      <div className="flex items-center justify-between gap-2 min-w-0 mt-auto">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-mono font-medium text-gray-900 truncate">
            {formatCatalogueCode(product)}
          </div>
          <div className="text-[11px] text-gray-600 truncate">{product.name || '—'}</div>
        </div>
        <Button
          type="button"
          variant="primary"
          size="sm"
          icon={Upload}
          className="shrink-0 text-xs px-2.5"
          loading={busy}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Upload
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
};

ProductCatalogueCard.propTypes = {
  product: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    code: PropTypes.string,
    size: PropTypes.string,
    main_image: PropTypes.string,
  }).isRequired,
  uploading: PropTypes.bool,
  onUploadStart: PropTypes.func,
  onUploadEnd: PropTypes.func,
};

ProductCatalogueCard.defaultProps = {
  uploading: false,
  onUploadStart: null,
  onUploadEnd: null,
};

export default ProductCatalogueCard;
