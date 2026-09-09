import { useQuery } from '@tanstack/react-query';
import PropTypes from 'prop-types';
import { Camera, ImagePlus, Loader2, Plus, Trash2, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { productsApi } from '../../lib/api/products.js';
import {
  buildProductCode,
  normalizeProductCode,
  normalizeProductName,
  parseProductCodeSuffix,
  resolveProductCodePrefixFromFormat,
  sanitizeCodeSuffixInput,
} from '../../lib/productCodeFormat.js';
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

const GALLERY_SLOTS = 4;

/**
 * Full product form block (same fields/images/code as Create Product) for related products.
 */
const RelatedProductFormBlock = ({
  index,
  values,
  errors,
  categoryOptions,
  colorOptions,
  sizeOptions,
  colorsLoading,
  sizesLoading,
  codeFormat,
  onChange,
  onRemove,
}) => {
  const mainInputRef = useRef(null);
  const bulkInputRef = useRef(null);
  const slotInputsRef = useRef([]);
  const [uploadingMain, setUploadingMain] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState(-1);
  const [bulkUploading, setBulkUploading] = useState(0);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [autoFillingCode, setAutoFillingCode] = useState(false);
  const [codeSuffix, setCodeSuffix] = useState('');
  const [mainCameraOpen, setMainCameraOpen] = useState(false);
  const [galleryCameraOpen, setGalleryCameraOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const set = (key, value) => onChange({ ...values, [key]: value });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const autoFillKeyRef = useRef('');
  const prevSizeRef = useRef(values.size || '');

  const categoryId = values.category_id || '';
  const productSize = values.size || '';
  const codePadding = Math.max(1, Math.min(10, Number(codeFormat?.padding) || 4));
  const activePrefix = useMemo(
    () => resolveProductCodePrefixFromFormat(codeFormat, categoryId),
    [codeFormat, categoryId]
  );
  const parsedCode = useMemo(
    () => parseProductCodeSuffix(values.code, activePrefix, codePadding),
    [values.code, activePrefix, codePadding]
  );
  const splitCodeMode = Boolean(activePrefix) && (parsedCode !== null || !values.code);

  const { data: lastCodeRes, isLoading: lastCodeLoading } = useQuery({
    queryKey: ['products', 'last-code', categoryId],
    queryFn: () => productsApi.lastCode({ category_id: categoryId }),
    enabled: Boolean(categoryId),
    staleTime: 30_000,
  });
  const maxCategoryCode = lastCodeRes?.data?.code || null;
  const maxCategoryNumber = lastCodeRes?.data?.max_number ?? null;
  const nextCategoryNumber = lastCodeRes?.data?.next_number ?? null;
  const nextCategoryCodePreview =
    activePrefix && nextCategoryNumber != null
      ? buildProductCode(activePrefix, nextCategoryNumber, codePadding, productSize)
      : activePrefix
        ? buildProductCode(activePrefix, 1, codePadding, productSize)
        : '';

  const selectedCategoryLabel = useMemo(() => {
    if (!categoryId) return '';
    return categoryOptions.find((c) => String(c.value) === String(categoryId))?.label || '';
  }, [categoryId, categoryOptions]);

  const displayCode = useMemo(() => {
    if (!splitCodeMode || !activePrefix) return values.code || '';
    const sanitized = sanitizeCodeSuffixInput(codeSuffix, codePadding);
    if (!sanitized) return '';
    const num = Number.parseInt(sanitized, 10);
    if (!Number.isFinite(num)) return values.code || '';
    return normalizeProductCode(buildProductCode(activePrefix, num, codePadding, productSize));
  }, [splitCodeMode, activePrefix, codeSuffix, codePadding, productSize, values.code]);

  const photos = Array.isArray(values.photos) ? values.photos : [];
  const slots = Array.from({ length: Math.max(GALLERY_SLOTS, photos.length + 1) });

  const syncSuffixFromCode = (fullCode) => {
    if (!activePrefix || !fullCode) {
      setCodeSuffix('');
      return;
    }
    const parsed = parseProductCodeSuffix(fullCode, activePrefix, codePadding);
    setCodeSuffix(parsed != null ? String(parsed.number) : '');
  };

  const commitCodeSuffix = (rawSuffix = codeSuffix) => {
    const sanitized = sanitizeCodeSuffixInput(rawSuffix, codePadding);
    setCodeSuffix(sanitized);
    if (!activePrefix) return;
    if (!sanitized) {
      onChangeRef.current((prev) => ({ ...prev, code: '' }));
      return;
    }
    const num = Number.parseInt(sanitized, 10);
    if (!Number.isFinite(num)) return;
    onChangeRef.current((prev) => ({
      ...prev,
      code: normalizeProductCode(
        buildProductCode(activePrefix, num, codePadding, prev.size || '')
      ),
    }));
  };

  // Keep suffix in sync when full code is set externally (e.g. generate).
  useEffect(() => {
    if (!splitCodeMode || !activePrefix) return;
    if (!values.code) {
      if (codeSuffix) return;
      return;
    }
    const parsed = parseProductCodeSuffix(values.code, activePrefix, codePadding);
    if (parsed != null && String(parsed.number) !== codeSuffix) {
      setCodeSuffix(String(parsed.number));
    }
  }, [values.code, activePrefix, codePadding, splitCodeMode, codeSuffix]);

  // Rebuild full code when size changes and a number is already entered.
  useEffect(() => {
    if (prevSizeRef.current === productSize) return;
    prevSizeRef.current = productSize;
    if (!splitCodeMode || !activePrefix) return;
    const sanitized = sanitizeCodeSuffixInput(codeSuffix, codePadding);
    if (!sanitized) return;
    const num = Number.parseInt(sanitized, 10);
    if (!Number.isFinite(num)) return;
    onChangeRef.current((prev) => ({
      ...prev,
      code: normalizeProductCode(buildProductCode(activePrefix, num, codePadding, productSize)),
    }));
  }, [productSize, splitCodeMode, activePrefix, codeSuffix, codePadding]);

  // Auto-fill next code when category is selected (prefix available).
  useEffect(() => {
    const key = `${categoryId}::${activePrefix}`;
    if (!categoryId || !activePrefix) {
      autoFillKeyRef.current = '';
      if (!categoryId) {
        setCodeSuffix('');
        onChangeRef.current((prev) => (prev.code ? { ...prev, code: '' } : prev));
      }
      return undefined;
    }
    if (autoFillKeyRef.current === key && values.code) return undefined;
    autoFillKeyRef.current = key;

    let cancelled = false;
    setAutoFillingCode(true);
    productsApi
      .nextCode({ category_id: categoryId, size: productSize })
      .then((res) => {
        if (cancelled) return;
        const code = res?.data?.code;
        if (!code) return;
        const normalized = normalizeProductCode(code);
        onChangeRef.current((prev) => ({ ...prev, code: normalized }));
        const parsed = parseProductCodeSuffix(normalized, activePrefix, codePadding);
        setCodeSuffix(parsed != null ? String(parsed.number) : '');
      })
      .catch(() => {
        if (!cancelled) toast.warning('Could not auto-generate code for this category');
      })
      .finally(() => {
        if (!cancelled) setAutoFillingCode(false);
      });

    return () => {
      cancelled = true;
    };
  }, [categoryId, activePrefix, productSize, codePadding, values.code]);

  const handleMainUpload = async (file) => {
    if (!file) return;
    let uploadFile = file;
    try {
      uploadFile = await prepareSingleImageForUpload(file, { title: 'Crop product photo' });
    } catch (err) {
      if (isImageCropCancelled(err)) return;
      toast.error(err?.message || 'Could not prepare image');
      if (mainInputRef.current) mainInputRef.current.value = '';
      return;
    }
    setUploadingMain(true);
    try {
      const { publicUrl } = await uploadToGCS(uploadFile, { folder: 'products' });
      set('main_image', publicUrl);
    } catch (err) {
      toast.error(err?.message || 'Failed to upload image');
    } finally {
      setUploadingMain(false);
      if (mainInputRef.current) mainInputRef.current.value = '';
    }
  };

  const handleSlotUpload = async (slotIndex, file) => {
    if (!file) return;
    let uploadFile = file;
    try {
      uploadFile = await prepareSingleImageForUpload(file, { title: 'Crop gallery photo' });
    } catch (err) {
      if (isImageCropCancelled(err)) return;
      toast.error(err?.message || 'Could not prepare image');
      const input = slotInputsRef.current[slotIndex];
      if (input) input.value = '';
      return;
    }
    setUploadingSlot(slotIndex);
    try {
      const { publicUrl } = await uploadToGCS(uploadFile, { folder: 'products' });
      const next = [...photos];
      next[slotIndex] = publicUrl;
      onChange({ ...values, photos: next });
    } catch (err) {
      toast.error(err?.message || 'Failed to upload image');
    } finally {
      setUploadingSlot(-1);
      const input = slotInputsRef.current[slotIndex];
      if (input) input.value = '';
    }
  };

  const handleBulkUpload = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f && f.type?.startsWith('image/'));
    if (!files.length) return;
    setBulkUploading((n) => n + files.length);
    try {
      const results = await Promise.allSettled(
        files.map((f) => uploadToGCS(f, { folder: 'products' }))
      );
      const uploaded = [];
      let failed = 0;
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value?.publicUrl) uploaded.push(r.value.publicUrl);
        else failed += 1;
      }
      if (uploaded.length) {
        onChange({
          ...values,
          photos: [...photos, ...uploaded],
        });
        toast.success(
          uploaded.length === 1 ? 'Image uploaded' : `${uploaded.length} images uploaded`
        );
      }
      if (failed) toast.error(`${failed} image${failed > 1 ? 's' : ''} failed to upload`);
    } finally {
      setBulkUploading((n) => Math.max(0, n - files.length));
      if (bulkInputRef.current) bulkInputRef.current.value = '';
    }
  };

  const removeSlot = (slotIndex) => {
    const next = [...photos];
    next.splice(slotIndex, 1);
    onChange({ ...values, photos: next });
  };

  const generateCode = async () => {
    if (!categoryId) {
      toast.warning('Select a category first to generate a code');
      return;
    }
    if (!activePrefix) {
      toast.warning('Configure a prefix for this category in Configuration → Code format');
      return;
    }
    setGeneratingCode(true);
    try {
      const res = await productsApi.nextCode({
        category_id: categoryId,
        size: productSize,
      });
      const code = res?.data?.code;
      if (code) {
        const normalized = normalizeProductCode(code);
        onChangeRef.current((prev) => ({ ...prev, code: normalized }));
        syncSuffixFromCode(normalized);
        toast.success(`Code generated: ${normalized}`);
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
        <h3 className="text-sm font-semibold text-gray-900">Related product {index + 1}</h3>
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
        <div className="w-full lg:w-44 flex-shrink-0">
          <input
            ref={mainInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleMainUpload(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => mainInputRef.current?.click()}
            className={`relative w-full aspect-square rounded-lg border border-dashed border-sky-200 transition overflow-hidden flex items-center justify-center p-2 ${
              values.main_image
                ? 'bg-white hover:border-brand hover:bg-sky-50/80'
                : 'bg-gray-50 hover:border-brand hover:bg-brand-light/40'
            }`}
            aria-label="Upload main image"
          >
            {values.main_image ? (
              <PreviewableUploadThumb
                src={values.main_image}
                alt="Main product image"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center text-gray-400">
                <ImagePlus size={32} strokeWidth={1.5} />
                <span className="text-xs mt-2">Main image</span>
              </div>
            )}
            {uploadingMain ? (
              <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                <Loader2 className="animate-spin text-brand" size={22} />
              </div>
            ) : null}
          </button>
          {values.main_image ? (
            <button
              type="button"
              onClick={() => set('main_image', '')}
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
              onClick={() => mainInputRef.current?.click()}
            >
              Device
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              icon={Camera}
              onClick={() => setMainCameraOpen(true)}
            >
              Camera
            </Button>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3">
            <Select
              label="Category"
              required
              value={values.category_id || ''}
              onChange={(e) => {
                autoFillKeyRef.current = '';
                setCodeSuffix('');
                onChange({ ...values, category_id: e.target.value, code: '' });
              }}
              placeholder="Select different category"
              options={categoryOptions}
              error={errors?.category_id}
              hint="Must differ from the main product and other related products"
            />
            <Input
              label="Product Name"
              required
              placeholder="Product Name"
              value={values.name || ''}
              onChange={(e) => set('name', String(e.target.value ?? '').toUpperCase())}
              onBlur={(e) => set('name', normalizeProductName(e.target.value))}
              error={errors?.name}
              className="col-span-2"
            />
            <Select
              label="Color"
              value={values.color || ''}
              onChange={(e) => set('color', e.target.value)}
              placeholder={colorsLoading ? 'Loading…' : 'Select'}
              options={colorOptions}
              disabled={colorsLoading}
            />
            <Select
              label="Size"
              value={values.size || ''}
              onChange={(e) => set('size', e.target.value)}
              placeholder={sizesLoading ? 'Loading…' : 'Select'}
              options={sizeOptions}
              disabled={sizesLoading}
            />
            <Select
              label="Type"
              value={values.type || 'rent'}
              onChange={(e) => set('type', e.target.value)}
              options={[
                { value: 'rent', label: 'Rent' },
                { value: 'sell', label: 'Sell' },
                { value: 'both', label: 'Rent + Sell' },
              ]}
            />
            <Input
              label="Rent"
              required
              type="number"
              step="0.01"
              value={values.price_rent ?? 0}
              onChange={(e) => set('price_rent', e.target.value === '' ? '' : Number(e.target.value))}
            />
            <Input
              label="Sell Price"
              type="number"
              step="0.01"
              value={values.price_sell ?? 0}
              onChange={(e) => set('price_sell', e.target.value === '' ? '' : Number(e.target.value))}
            />
            <div className="col-span-2 md:col-span-4">
              <label htmlFor="related-product-code" className="label">
                Code<span className="text-red-500 ml-0.5">*</span>
              </label>
              {splitCodeMode ? (
                <div className="flex gap-1 items-stretch">
                  <span
                    className="input shrink-0 w-auto min-w-[4rem] max-w-[40%] bg-gray-50 font-mono text-sm flex items-center text-gray-700"
                    title="Prefix from Code format configuration"
                  >
                    {activePrefix}
                  </span>
                  <input
                    id="related-product-code"
                    required
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder={String(1).padStart(codePadding, '0')}
                    value={codeSuffix}
                    onChange={(e) => {
                      const sanitized = sanitizeCodeSuffixInput(e.target.value, codePadding);
                      setCodeSuffix(sanitized);
                      if (!activePrefix) return;
                      if (!sanitized) {
                        onChangeRef.current((prev) => ({ ...prev, code: '' }));
                        return;
                      }
                      const num = Number.parseInt(sanitized, 10);
                      if (!Number.isFinite(num)) return;
                      onChangeRef.current((prev) => ({
                        ...prev,
                        code: normalizeProductCode(
                          buildProductCode(activePrefix, num, codePadding, prev.size || '')
                        ),
                      }));
                    }}
                    onBlur={(e) => commitCodeSuffix(e.target.value)}
                    disabled={!categoryId}
                    className={`input flex-1 font-mono ${
                      errors?.code ? 'border-red-400 focus:border-red-500 focus:ring-red-400' : ''
                    }`}
                  />
                  <button
                    type="button"
                    onClick={generateCode}
                    disabled={
                      generatingCode || autoFillingCode || !categoryId || !activePrefix
                    }
                    title="Auto-generate next code"
                    className="px-2.5 rounded-md border border-gray-200 bg-white text-gray-600 hover:text-brand hover:border-brand-light hover:bg-brand-light/40 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center"
                    aria-label="Generate code"
                  >
                    {generatingCode || autoFillingCode ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Wand2 size={15} />
                    )}
                  </button>
                </div>
              ) : (
                <div className="flex gap-1">
                  <input
                    id="related-product-code"
                    required
                    placeholder="Code"
                    value={values.code || ''}
                    onChange={(e) => set('code', normalizeProductCode(e.target.value))}
                    onBlur={(e) => set('code', normalizeProductCode(e.target.value))}
                    className={`input flex-1 font-mono ${
                      errors?.code ? 'border-red-400 focus:border-red-500 focus:ring-red-400' : ''
                    }`}
                  />
                  <button
                    type="button"
                    onClick={generateCode}
                    disabled={generatingCode || !categoryId}
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
              )}
              {splitCodeMode && displayCode ? (
                <p className="mt-1.5 text-xs font-mono text-gray-700">
                  Full code: <span className="font-semibold text-gray-900">{displayCode}</span>
                </p>
              ) : null}
              {categoryId ? (
                <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-600 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                    <span className="text-gray-500">Highest code in</span>
                    <span className="font-medium text-gray-800">
                      {selectedCategoryLabel || 'this category'}
                    </span>
                    <span className="text-gray-500">:</span>
                    {lastCodeLoading ? (
                      <span className="text-gray-400">Loading…</span>
                    ) : maxCategoryCode ? (
                      <span className="font-mono font-semibold text-gray-900">
                        {maxCategoryCode}
                      </span>
                    ) : maxCategoryNumber != null && maxCategoryNumber > 0 ? (
                      <span className="font-mono font-semibold text-gray-900">
                        {activePrefix}
                        {String(maxCategoryNumber).padStart(codePadding, '0')}
                      </span>
                    ) : (
                      <span className="text-gray-500 italic">None yet</span>
                    )}
                  </div>
                  {activePrefix && !lastCodeLoading ? (
                    <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 text-gray-500">
                      <span>Next code with prefix</span>
                      <span className="font-mono text-gray-700">{activePrefix}</span>
                      <span>:</span>
                      <button
                        type="button"
                        className="font-mono font-medium text-brand hover:underline"
                        onClick={() => {
                          if (!nextCategoryCodePreview) return;
                          const normalized = normalizeProductCode(nextCategoryCodePreview);
                          onChangeRef.current((prev) => ({ ...prev, code: normalized }));
                          syncSuffixFromCode(normalized);
                        }}
                      >
                        {nextCategoryCodePreview}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {errors?.code ? (
                <p className="mt-1 text-xs text-red-600">{errors.code}</p>
              ) : categoryId && !activePrefix ? (
                <p className="mt-1 text-xs text-amber-700">
                  Configure a prefix for this category under Configuration → Code format.
                </p>
              ) : (
                <p className="mt-1 text-xs text-gray-500">
                  {!categoryId
                    ? 'Select a category to apply the configured prefix and number.'
                    : splitCodeMode
                      ? `Enter the number only (size is added separately). Each number can only be used once — e.g. if ${activePrefix}888 exists, you cannot add another ${activePrefix}888 with a different size.`
                      : 'Enter the full product code or use Generate for the next value in this category.'}
                </p>
              )}
            </div>
            <Input
              label="Qty"
              type="number"
              value={values.qty ?? 1}
              onChange={(e) => set('qty', e.target.value === '' ? '' : Number(e.target.value))}
            />
            <Input
              label="Lifetime Gap"
              type="number"
              min={0}
              value={values.lifetime_gap ?? 0}
              onChange={(e) =>
                set('lifetime_gap', e.target.value === '' ? '' : Number(e.target.value))
              }
              hint="0 = unlimited"
            />
          </div>

          <div className="mt-3">
            <label htmlFor="related-product-remark" className="label">Remark</label>
            <textarea
              id="related-product-remark"
              className="input min-h-[72px]"
              value={values.notes || ''}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Type your remark here"
            />
          </div>
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="related-product-gallery" className="label">Gallery images</label>
        <input
          id="related-product-gallery"
          ref={bulkInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleBulkUpload(e.target.files)}
        />
        <div
          className={`rounded-lg border border-dashed p-3 transition ${
            isDragging ? 'border-brand bg-brand-light/30' : 'border-gray-200 bg-gray-50/50'
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleBulkUpload(e.dataTransfer.files);
          }}
        >
          <div className="flex flex-wrap gap-2">
            {slots.map((_, slotIndex) => {
              const url = photos[slotIndex];
              const isUploading = uploadingSlot === slotIndex;
              return (
                <div key={`slot-${slotIndex}`} className="relative">
                  <input
                    ref={(el) => {
                      slotInputsRef.current[slotIndex] = el;
                    }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleSlotUpload(slotIndex, e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => slotInputsRef.current[slotIndex]?.click()}
                    className="relative w-20 h-20 rounded-lg border border-dashed border-sky-200 bg-white hover:border-brand hover:bg-sky-50/80 overflow-hidden flex items-center justify-center p-1 transition"
                    aria-label={`Upload image ${slotIndex + 1}`}
                  >
                    {url ? (
                      <img
                        src={url}
                        alt={`Product ${slotIndex + 1}`}
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <ImagePlus size={20} className="text-gray-400" strokeWidth={1.5} />
                    )}
                    {isUploading ? (
                      <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                        <Loader2 className="animate-spin text-brand" size={16} />
                      </div>
                    ) : null}
                  </button>
                  {url ? (
                    <button
                      type="button"
                      onClick={() => removeSlot(slotIndex)}
                      className="absolute -top-1.5 -right-1.5 bg-white border border-gray-200 rounded-full p-0.5 text-gray-500 hover:text-red-600 hover:border-red-300 shadow-sm"
                      aria-label="Remove image"
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => bulkInputRef.current?.click()}
              className="relative w-20 h-20 rounded-lg border border-dashed border-sky-200 bg-white hover:border-brand hover:bg-sky-50/80 flex flex-col items-center justify-center text-gray-500 hover:text-brand transition"
              aria-label="Upload multiple images"
              disabled={bulkUploading > 0}
            >
              {bulkUploading > 0 ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <>
                  <Plus size={18} />
                  <span className="text-[10px] mt-1">Add</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setGalleryCameraOpen(true)}
              className="relative w-20 h-20 rounded-lg border border-dashed border-sky-200 bg-white hover:border-brand hover:bg-sky-50/80 flex flex-col items-center justify-center text-gray-500 hover:text-brand transition"
              aria-label="Capture image from camera"
              disabled={bulkUploading > 0}
            >
              <Camera size={18} />
              <span className="text-[10px] mt-1">Camera</span>
            </button>
          </div>
        </div>
      </div>

      <CameraCaptureModal
        isOpen={mainCameraOpen}
        onClose={() => setMainCameraOpen(false)}
        onCapture={handleMainUpload}
        title="Capture product image"
      />
      <CameraCaptureModal
        isOpen={galleryCameraOpen}
        onClose={() => setGalleryCameraOpen(false)}
        onCapture={(file) => handleBulkUpload(file ? [file] : [])}
        title="Capture gallery image"
      />
    </div>
  );
};

RelatedProductFormBlock.propTypes = {
  index: PropTypes.number.isRequired,
  values: PropTypes.object.isRequired,
  errors: PropTypes.object,
  categoryOptions: PropTypes.arrayOf(PropTypes.object).isRequired,
  colorOptions: PropTypes.arrayOf(PropTypes.object).isRequired,
  sizeOptions: PropTypes.arrayOf(PropTypes.object).isRequired,
  colorsLoading: PropTypes.bool,
  sizesLoading: PropTypes.bool,
  codeFormat: PropTypes.object,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

export default RelatedProductFormBlock;
