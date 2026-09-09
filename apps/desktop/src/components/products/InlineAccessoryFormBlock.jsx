import PropTypes from 'prop-types';
import { Camera, ImagePlus, Loader2, Trash2, Wand2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { accessoriesApi } from '../../lib/api/accessories.js';
import { normalizeProductCode } from '../../lib/productCodeFormat.js';
import { uploadToGCS } from '../../services/gcsUpload.js';
import {
  isImageCropCancelled,
  prepareSingleImageForUpload,
} from '../../services/imagePickWithCrop.js';
import { toast } from '../../stores/uiStore.js';
import Button from '../ui/Button.jsx';
import CameraCaptureModal from '../ui/CameraCaptureModal.jsx';
import Input from '../ui/Input.jsx';
import PreviewableUploadThumb from '../ui/PreviewableUploadThumb.jsx';
import Select from '../ui/Select.jsx';

/**
 * Full accessory create form for stacking multiple accessories under Create Product.
 */
const InlineAccessoryFormBlock = ({
  index,
  values,
  errors,
  categoryOptions,
  onChange,
  onRemove,
}) => {
  const imageInputRef = useRef(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const set = (key, value) => onChange({ ...values, [key]: value });

  const handleImageUpload = async (file) => {
    if (!file) return;
    let uploadFile = file;
    try {
      uploadFile = await prepareSingleImageForUpload(file, { title: 'Crop accessory photo' });
    } catch (err) {
      if (isImageCropCancelled(err)) return;
      toast.error(err?.message || 'Could not prepare image');
      if (imageInputRef.current) imageInputRef.current.value = '';
      return;
    }
    setUploadingImage(true);
    try {
      const { publicUrl } = await uploadToGCS(uploadFile, { folder: 'accessories' });
      set('image_url', publicUrl);
    } catch (err) {
      toast.error(err?.message || 'Failed to upload image');
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const generateCode = async () => {
    if (!values.category_id) {
      toast.warning('Select a category first to generate a code');
      return;
    }
    setGeneratingCode(true);
    try {
      const res = await accessoriesApi.nextCode({ category_id: values.category_id });
      const code = res?.data?.code;
      if (code) {
        set('code', normalizeProductCode(code));
        toast.success(`Code generated: ${code}`);
      } else {
        toast.error('Could not generate code');
      }
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Failed to generate code');
    } finally {
      setGeneratingCode(false);
    }
  };

  return (
    <div className="card p-5 mt-4 border border-gray-200">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Accessory {index + 1}</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={Trash2}
          className="text-red-600 hover:bg-red-50"
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:w-40 flex-shrink-0">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleImageUpload(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className={`relative w-full aspect-square rounded-lg border border-dashed border-sky-200 transition overflow-hidden flex items-center justify-center p-2 ${
              values.image_url
                ? 'bg-white hover:border-brand hover:bg-sky-50/80'
                : 'bg-gray-50 hover:border-brand hover:bg-brand-light/40'
            }`}
            aria-label="Upload accessory image"
          >
            {values.image_url ? (
              <PreviewableUploadThumb
                src={values.image_url}
                alt="Accessory image"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center text-gray-400">
                <ImagePlus size={28} strokeWidth={1.5} />
                <span className="text-xs mt-2">Image</span>
              </div>
            )}
            {uploadingImage ? (
              <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                <Loader2 className="animate-spin text-brand" size={20} />
              </div>
            ) : null}
          </button>
          {values.image_url ? (
            <button
              type="button"
              onClick={() => set('image_url', '')}
              className="mt-2 text-left text-xs text-sky-700/80 hover:text-red-600"
            >
              Remove image
            </button>
          ) : null}
          <div className="mt-2 flex gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              icon={ImagePlus}
              onClick={() => imageInputRef.current?.click()}
            >
              Device
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              icon={Camera}
              onClick={() => setCameraOpen(true)}
            >
              Camera
            </Button>
          </div>
        </div>

        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Select
            label="Category"
            required
            value={values.category_id || ''}
            onChange={(e) => set('category_id', e.target.value)}
            options={[{ value: '', label: 'Select' }, ...categoryOptions]}
            error={errors?.category_id}
          />
          <Input
            label="Name"
            required
            value={values.name || ''}
            onChange={(e) => set('name', e.target.value)}
            error={errors?.name}
            className="sm:col-span-2"
          />
          <div>
            <label htmlFor="inline-accessory-code" className="label">Code</label>
            <div className="flex gap-1">
              <input
                id="inline-accessory-code"
                placeholder="Auto if blank"
                value={values.code || ''}
                onChange={(e) => set('code', e.target.value)}
                onBlur={(e) => {
                  if (e.target.value) set('code', normalizeProductCode(e.target.value));
                }}
                className="input flex-1 font-mono"
              />
              <button
                type="button"
                onClick={generateCode}
                disabled={generatingCode || !values.category_id}
                title="Auto-generate next code"
                className="px-2.5 rounded-md border border-gray-200 bg-white text-gray-600 hover:text-brand hover:border-brand-light hover:bg-brand-light/40 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center"
                aria-label="Generate code"
              >
                {generatingCode ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Wand2 size={15} />
                )}
              </button>
            </div>
          </div>
          <Select
            label="Default type"
            value={values.default_type || 'rent'}
            onChange={(e) => set('default_type', e.target.value)}
            options={[
              { value: 'rent', label: 'Rent' },
              { value: 'sell', label: 'Sell' },
              { value: 'both', label: 'Both' },
            ]}
          />
          <Select
            label="Default order status"
            value={values.default_order_status || 'regular'}
            onChange={(e) => set('default_order_status', e.target.value)}
            options={[
              { value: 'regular', label: 'Regular' },
              { value: 'given_with_rent', label: 'Given free with rent' },
              { value: 'pack_with_rent', label: 'Packed with rent' },
            ]}
          />
          <Select
            label="Unit"
            value={values.unit || 'pcs'}
            onChange={(e) => set('unit', e.target.value)}
            options={[
              { value: 'pcs', label: 'pcs' },
              { value: 'pair', label: 'pair' },
              { value: 'set', label: 'set' },
            ]}
          />
          <Input
            label="Qty in stock"
            type="number"
            value={values.qty ?? 1}
            onChange={(e) => set('qty', e.target.value === '' ? '' : Number(e.target.value))}
          />
          <Input
            label="Spare qty"
            type="number"
            value={values.spare_qty ?? 0}
            onChange={(e) => set('spare_qty', e.target.value === '' ? '' : Number(e.target.value))}
            hint="Reserved stock not available for booking or sale"
          />
          <Input
            label="Low stock alert"
            type="number"
            value={values.threshold ?? 5}
            onChange={(e) => set('threshold', e.target.value === '' ? '' : Number(e.target.value))}
            hint="Alert when in-shop qty is below this value"
          />
          <Input
            label="Purchase price"
            type="number"
            step="0.01"
            value={values.purchase_price ?? 0}
            onChange={(e) =>
              set('purchase_price', e.target.value === '' ? '' : Number(e.target.value))
            }
          />
          <Input
            label="Sell price"
            type="number"
            step="0.01"
            value={values.price_sell ?? 0}
            onChange={(e) => set('price_sell', e.target.value === '' ? '' : Number(e.target.value))}
          />
          <Input
            label="Rent"
            type="number"
            step="0.01"
            value={values.price_rent ?? 0}
            onChange={(e) => set('price_rent', e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor="inline-accessory-remark" className="label">Remark</label>
        <textarea
          id="inline-accessory-remark"
          className="input min-h-[72px]"
          value={values.notes || ''}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Type your remark here"
        />
      </div>

      <CameraCaptureModal
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleImageUpload}
        title="Capture accessory image"
      />
    </div>
  );
};

InlineAccessoryFormBlock.propTypes = {
  index: PropTypes.number.isRequired,
  values: PropTypes.object.isRequired,
  errors: PropTypes.object,
  categoryOptions: PropTypes.arrayOf(PropTypes.object).isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

export default InlineAccessoryFormBlock;
