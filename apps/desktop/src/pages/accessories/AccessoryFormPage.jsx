import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { validateFields, accessoryRentableQty, normalizeProductCode } from '@wrs/shared';
import { ArrowLeft, Camera, ImagePlus, Loader2, Printer, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import Button from '../../components/ui/Button.jsx';
import Barcode from '../../components/ui/Barcode.jsx';
import CameraCaptureModal from '../../components/ui/CameraCaptureModal.jsx';
import Input from '../../components/ui/Input.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import PreviewableUploadThumb from '../../components/ui/PreviewableUploadThumb.jsx';
import Select from '../../components/ui/Select.jsx';
import { accessoriesApi } from '../../lib/api/accessories.js';
import { ACCESSORY_BASE_PATH } from '../../lib/accessoryRoutes.js';
import { buildAccessoryDuplicateDraft } from '../../lib/accessoryDuplicate.js';
import { categoriesApi } from '../../lib/api/categories.js';
import { configurationsApi } from '../../lib/api/configurations.js';
import { sortColorsAZ } from '../../lib/colorOrder.js';
import { uploadToGCS } from '../../services/gcsUpload.js';
import {
  isImageCropCancelled,
  prepareSingleImageForUpload,
} from '../../services/imagePickWithCrop.js';
import { invalidateCatalogDomain } from '../../lib/queryInvalidation.js';
import { rejectSubmit } from '../../lib/formValidation.js';
import { toast } from '../../stores/uiStore.js';
import { printBarcodeLabels } from '../../utils/printBarcode.js';
import { useAccessoryLastCode } from '../../hooks/api/useAccessoryLastCode.js';
import AccessoryCodeHint from './AccessoryCodeHint.jsx';

const ACCESSORY_RULES = {
  name: { required: true, label: 'Accessory name' },
  category_id: { required: true, label: 'Accessory category' },
};

const empty = {
  code: '',
  name: '',
  image_url: '',
  color: '',
  size: '',
  default_type: 'rent',
  default_order_status: 'regular',
  qty: 0,
  spare_qty: 0,
  damaged_qty: 0,
  threshold: 5,
  unit: 'pcs',
  price_rent: 0,
  price_sell: 0,
  purchase_price: 0,
  notes: '',
  category_id: '',
};

const AccessoryFormPage = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const duplicateFromId = String(searchParams.get('duplicate') || '').trim();
  const isEdit = Boolean(id);
  const isDuplicate = Boolean(duplicateFromId) && !isEdit;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState({});
  const [uploadingImage, setUploadingImage] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [autoFillingCode, setAutoFillingCode] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const imageInputRef = useRef(null);
  const categoryId = values.category_id || '';
  const lastCodeQuery = useAccessoryLastCode(categoryId);

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ['accessory', id],
    queryFn: () => accessoriesApi.get(id),
    enabled: isEdit,
  });

  const duplicateQuery = useQuery({
    queryKey: ['accessory', 'duplicate', duplicateFromId],
    queryFn: () => accessoriesApi.get(duplicateFromId),
    enabled: isDuplicate,
  });

  const { data: accessoryCats, isLoading: accessoryCatsLoading } = useQuery({
    queryKey: ['categories', 'accessory'],
    queryFn: () => categoriesApi.list({ type: 'accessory' }),
  });

  const { data: unitsRes, isLoading: unitsLoading } = useQuery({
    queryKey: ['configurations', 'units'],
    queryFn: () => configurationsApi.get('units'),
    staleTime: 60_000,
  });

  const { data: colorsRes } = useQuery({
    queryKey: ['configurations', 'colors'],
    queryFn: () => configurationsApi.get('colors'),
    staleTime: 60_000,
  });

  const { data: sizesRes } = useQuery({
    queryKey: ['configurations', 'sizes'],
    queryFn: () => configurationsApi.get('sizes'),
    staleTime: 60_000,
  });

  const { data: codeFormatRes } = useQuery({
    queryKey: ['accessory-code-format'],
    queryFn: () => accessoriesApi.getCodeFormat(),
    staleTime: 60_000,
  });

  const codeFormat = codeFormatRes?.data || {};
  const activePrefix = useMemo(() => {
    if (categoryId && codeFormat.by_category?.[categoryId]) {
      return String(codeFormat.by_category[categoryId] || '').trim();
    }
    return String(codeFormat.default_prefix ?? codeFormat.prefix ?? 'ACC').trim();
  }, [categoryId, codeFormat]);
  const unitsFromConfig = unitsRes?.data?.items || [];
  const curUnit = (values.unit || '').trim();
  const unitChoices =
    curUnit && !unitsFromConfig.some((x) => String(x).toLowerCase() === curUnit.toLowerCase())
      ? [curUnit, ...unitsFromConfig]
      : unitsFromConfig;

  // Same trick as units: if the saved value has since been removed from the
  // master list, keep it selectable so editing doesn't silently blank it.
  const colorChoices = useMemo(() => {
    const configured = sortColorsAZ(colorsRes?.data?.items);
    const cur = (values.color || '').trim();
    return cur && !configured.some((x) => String(x).toLowerCase() === cur.toLowerCase())
      ? [cur, ...configured]
      : configured;
  }, [colorsRes?.data?.items, values.color]);

  const sizeChoices = useMemo(() => {
    const configured = sizesRes?.data?.items || [];
    const cur = (values.size || '').trim();
    return cur && !configured.some((x) => String(x).toLowerCase() === cur.toLowerCase())
      ? [cur, ...configured]
      : configured;
  }, [sizesRes?.data?.items, values.size]);

  const initialValues = useMemo(() => {
    if (isEdit && existing?.data) {
      const d = existing.data;
      return {
        ...empty,
        ...d,
        category_id: d.category_id || '',
      };
    }
    return empty;
  }, [isEdit, existing]);

  useEffect(() => {
    if (isDuplicate) return;
    setValues(initialValues);
  }, [initialValues, isDuplicate]);

  useEffect(() => {
    if (!isDuplicate || !duplicateQuery.data?.data) return;
    setValues(buildAccessoryDuplicateDraft(duplicateQuery.data.data));
  }, [isDuplicate, duplicateQuery.data]);

  useEffect(() => {
    if (isEdit) return undefined;
    if (!categoryId) {
      setValues((old) => ({ ...old, code: '' }));
      return undefined;
    }
    if (!activePrefix) return undefined;
    let cancelled = false;
    setAutoFillingCode(true);
    accessoriesApi
      .nextCode({ category_id: categoryId })
      .then((res) => {
        if (cancelled) return;
        const code = res?.data?.code;
        if (code) setValues((old) => ({ ...old, code: normalizeProductCode(code) }));
      })
      .catch(() => {
        if (!cancelled) toast.error('Could not load next accessory code');
      })
      .finally(() => {
        if (!cancelled) setAutoFillingCode(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId, activePrefix, isEdit, isDuplicate]);

  useEffect(() => {
    if (!isDuplicate || !duplicateQuery.isError) return;
    toast.error('Could not load accessory to duplicate');
    navigate(ACCESSORY_BASE_PATH);
  }, [isDuplicate, duplicateQuery.isError, navigate]);

  const mutation = useMutation({
    mutationFn: (body) => (isEdit ? accessoriesApi.update(id, body) : accessoriesApi.create(body)),
    onSuccess: async () => {
      toast.success(
        isEdit ? 'Accessory updated' : isDuplicate ? 'Accessory duplicated' : 'Accessory created'
      );
      await invalidateCatalogDomain(queryClient, { accessoryId: isEdit ? id : undefined });
      navigate(ACCESSORY_BASE_PATH);
    },
    onError: (e) => {
      const details = e.response?.data?.error?.details;
      if (Array.isArray(details)) {
        const fe = {};
        for (const d of details) fe[d.path] = d.message;
        setErrors(fe);
      }
      toast.error(e.response?.data?.error?.message || 'Failed to save');
    },
  });

  const set = (k, v) => {
    setValues((old) => ({ ...old, [k]: v }));
    if (errors[k]) setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const generateCode = async () => {
    if (!categoryId) {
      toast.error('Select a category first');
      return;
    }
    setGeneratingCode(true);
    try {
      const res = await accessoriesApi.nextCode({ category_id: categoryId });
      const code = res?.data?.code;
      if (code) set('code', normalizeProductCode(code));
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Could not generate code');
    } finally {
      setGeneratingCode(false);
    }
  };

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
      toast.success('Image uploaded');
    } catch (err) {
      toast.error(err?.message || 'Failed to upload image');
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const reset = () => {
    if (isDuplicate && duplicateQuery.data?.data) {
      setValues(buildAccessoryDuplicateDraft(duplicateQuery.data.data));
    } else {
      setValues(initialValues);
    }
    setErrors({});
  };

  const submit = (e) => {
    e.preventDefault();
    const validationValues = {
      name: values.name,
      category_id: values.category_id || '',
    };
    const errs = validateFields(validationValues, ACCESSORY_RULES);
    if (
      rejectSubmit({ errors: errs, setErrors, toast, message: 'Please fix the highlighted fields' })
    ) {
      return;
    }
    const qty = Math.max(0, Number(values.qty) || 0);
    const spareQty = Math.max(0, Number(values.spare_qty) || 0);
    const damagedQty = Math.max(0, Number(values.damaged_qty) || 0);
    if (spareQty > qty) {
      setErrors((prev) => ({ ...prev, spare_qty: 'Spare qty cannot exceed qty in stock' }));
      toast.error('Spare qty cannot exceed qty in stock');
      return;
    }
    if (damagedQty > qty) {
      setErrors((prev) => ({ ...prev, damaged_qty: 'Damaged qty cannot exceed qty in stock' }));
      toast.error('Damaged qty cannot exceed qty in stock');
      return;
    }
    if (spareQty + damagedQty > qty) {
      const message = 'Spare and damaged qty together cannot exceed qty in stock';
      setErrors((prev) => ({ ...prev, damaged_qty: message }));
      toast.error(message);
      return;
    }
    const body = { ...values, qty, spare_qty: spareQty, damaged_qty: damagedQty };
    if (!body.image_url) body.image_url = null;
    body.category_id = values.category_id || null;
    body.color = (values.color || '').trim() || null;
    body.size = (values.size || '').trim() || null;
    mutation.mutate(body);
  };

  const title = isEdit
    ? 'Edit Accessory'
    : isDuplicate
      ? 'Duplicate Accessory'
      : 'Create Accessory';
  const availableForUse = accessoryRentableQty({
    qty: Number(values.qty) || 0,
    spare_qty: Number(values.spare_qty) || 0,
    damaged_qty: Number(values.damaged_qty) || 0,
  });
  const description = isEdit
    ? 'Update accessory details for your catalog.'
    : isDuplicate
      ? 'Review copied details, change what you need, then save as a new accessory.'
      : 'Add an accessory to track stock and sales.';

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate(ACCESSORY_BASE_PATH)}>
            Back to accessories
          </Button>
        }
      />

      {(isEdit && loadingExisting) || (isDuplicate && duplicateQuery.isLoading) ? (
        <div className="card p-6 text-sm text-gray-500">
          {isDuplicate ? 'Loading accessory to duplicate…' : 'Loading accessory…'}
        </div>
      ) : (
        <form onSubmit={submit} className="card p-5">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Catalog image (left) — single image_url, uploaded to GCS */}
            <div className="w-full lg:w-56 flex-shrink-0">
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
                    alt="Accessory catalog image"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center text-gray-400">
                    <ImagePlus size={36} strokeWidth={1.5} />
                    <span className="text-xs mt-2">Catalog image</span>
                  </div>
                )}
                {uploadingImage ? (
                  <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                    <Loader2 className="animate-spin text-brand" size={22} />
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
              ) : (
                <p className="mt-2 text-xs text-gray-500">
                  Click to upload. Photos are quality-optimized to a target of 500-700 KB.
                </p>
              )}
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

            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3">
                <Select
                  label="Accessory Category"
                  required
                  value={values.category_id || ''}
                  error={errors.category_id}
                  onChange={(e) => set('category_id', e.target.value)}
                  placeholder={accessoryCatsLoading ? 'Loading…' : 'Select'}
                  options={(accessoryCats?.data || []).map((c) => ({
                    value: c.id,
                    label: c.label,
                  }))}
                  disabled={accessoryCatsLoading}
                  className="md:col-span-2"
                />
                <Input
                  label="Accessory name"
                  required
                  placeholder="Accessory name"
                  value={values.name}
                  onChange={(e) => set('name', e.target.value)}
                  error={errors.name}
                  className="md:col-span-2"
                />
                <Select
                  label="Color"
                  value={values.color || ''}
                  onChange={(e) => set('color', e.target.value)}
                  placeholder="Select"
                  options={colorChoices.map((c) => ({ value: c, label: c }))}
                  hint={
                    colorChoices.length === 0
                      ? 'No colors configured yet (Master → Color families).'
                      : undefined
                  }
                />
                <Select
                  label="Size"
                  value={values.size || ''}
                  onChange={(e) => set('size', e.target.value)}
                  placeholder="Select"
                  options={sizeChoices.map((s) => ({ value: s, label: s }))}
                  hint={
                    sizeChoices.length === 0
                      ? 'No sizes configured yet (Master → Sizes).'
                      : undefined
                  }
                />
                <div className="md:col-span-2">
                  <label className="label" htmlFor="accessory-code-input">
                    Code
                  </label>
                  <div className="flex gap-1">
                    <input
                      id="accessory-code-input"
                      required
                      placeholder="Code"
                      value={values.code || ''}
                      onChange={(e) => set('code', normalizeProductCode(e.target.value))}
                      onBlur={(e) => set('code', normalizeProductCode(e.target.value))}
                      className={`input flex-1 font-mono ${errors.code ? 'border-red-400 focus:border-red-500 focus:ring-red-400' : ''}`}
                    />
                    <button
                      type="button"
                      onClick={() => void generateCode()}
                      disabled={generatingCode || autoFillingCode || !categoryId || !activePrefix}
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
                  {errors.code ? (
                    <p className="mt-1 text-xs text-red-600">{errors.code}</p>
                  ) : categoryId && !activePrefix ? (
                    <p className="mt-1 text-xs text-amber-700">
                      Configure a prefix for this category under Configuration → Code format.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-gray-500">
                      Select a category to auto-fill the next code, or enter manually.
                    </p>
                  )}
                  <AccessoryCodeHint
                    categoryId={categoryId}
                    prefix={activePrefix}
                    data={lastCodeQuery.data?.data}
                    loading={lastCodeQuery.isLoading}
                    error={lastCodeQuery.isError}
                  />
                </div>
                <Select
                  label="Default type"
                  value={values.default_type}
                  onChange={(e) => set('default_type', e.target.value)}
                  options={[
                    { value: 'rent', label: 'Rent' },
                    { value: 'sell', label: 'Sell' },
                    { value: 'both', label: 'Rent + Sell' },
                  ]}
                />
                <Select
                  label="Default order status"
                  value={values.default_order_status}
                  onChange={(e) => set('default_order_status', e.target.value)}
                  options={[
                    { value: 'regular', label: 'Regular' },
                    { value: 'given_with_rent', label: 'Given free with rent' },
                    { value: 'pack_with_rent', label: 'Packed with rent' },
                  ]}
                />
                <Select
                  label="Unit"
                  value={values.unit || ''}
                  onChange={(e) => set('unit', e.target.value)}
                  placeholder={unitsLoading ? 'Loading…' : 'Select'}
                  options={unitChoices.map((u) => ({ value: u, label: u }))}
                  disabled={unitsLoading}
                  hint={
                    !unitsLoading && unitsFromConfig.length === 0
                      ? 'No units configured yet for this shop (Configuration → Units).'
                      : undefined
                  }
                />
                <Input
                  label="Qty in stock"
                  type="number"
                  value={values.qty}
                  onChange={(e) => set('qty', e.target.value === '' ? '' : Number(e.target.value))}
                />
                <Input
                  label="Spare qty"
                  type="number"
                  hint="Reserved stock not available for booking or sale"
                  value={values.spare_qty}
                  error={errors.spare_qty}
                  onChange={(e) =>
                    set('spare_qty', e.target.value === '' ? '' : Number(e.target.value))
                  }
                />
                <Input
                  label="Damaged qty"
                  type="number"
                  hint="Written off — excluded from in-shop and rentable stock. Reduce after repair."
                  value={values.damaged_qty}
                  error={errors.damaged_qty}
                  onChange={(e) =>
                    set('damaged_qty', e.target.value === '' ? '' : Number(e.target.value))
                  }
                />
                <Input
                  label="Low stock alert"
                  type="number"
                  hint="Alert when in-shop qty is below this value. Set 0 to disable low-stock alerts for this item."
                  value={values.threshold}
                  onChange={(e) =>
                    set('threshold', e.target.value === '' ? '' : Number(e.target.value))
                  }
                />
                <Input
                  label="Purchase price"
                  type="number"
                  step="0.01"
                  value={values.purchase_price}
                  onChange={(e) =>
                    set('purchase_price', e.target.value === '' ? '' : Number(e.target.value))
                  }
                />
                <Input
                  label="Sell price"
                  type="number"
                  step="0.01"
                  value={values.price_sell}
                  onChange={(e) =>
                    set('price_sell', e.target.value === '' ? '' : Number(e.target.value))
                  }
                />
                <Input
                  label="Rent"
                  type="number"
                  step="0.01"
                  value={values.price_rent}
                  onChange={(e) =>
                    set('price_rent', e.target.value === '' ? '' : Number(e.target.value))
                  }
                />
              </div>

              <div className="mt-4">
                <div className="label">Barcode</div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-center justify-center overflow-visible bg-white rounded px-3 py-3 min-w-[180px]">
                    {values.code ? (
                      <Barcode
                        value={values.code}
                        height={56}
                        fontSize={12}
                        margin={10}
                        className="max-w-full overflow-visible"
                      />
                    ) : (
                      <span className="text-xs text-gray-400">
                        Enter or generate a code to preview
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-xs text-gray-600 space-y-1">
                    <div>
                      <span className="text-gray-500">Value: </span>
                      <span className="font-mono text-gray-800">{values.code || '—'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Format: </span>
                      <span className="text-gray-800">CODE128</span>
                    </div>
                    <p className="text-gray-500 pt-1">
                      Barcode is generated from the accessory code — not stored separately.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      icon={Printer}
                      disabled={!values.code}
                      onClick={() => {
                        try {
                          printBarcodeLabels({
                            value: values.code,
                            name: values.name,
                            count: Math.max(1, Number(values.qty) || 1),
                          });
                        } catch (err) {
                          toast.error(err?.message || 'Failed to open print window');
                        }
                      }}
                    >
                      Print {Math.max(1, Number(values.qty) || 1)}×
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <label className="label" htmlFor="accessory-notes">
                  Remark
                </label>
                <textarea
                  id="accessory-notes"
                  className="input min-h-[80px]"
                  placeholder="Type your remark here"
                  value={values.notes || ''}
                  onChange={(e) => set('notes', e.target.value)}
                />
              </div>

              <p className="mt-5 text-xs text-gray-500">
                One catalog image per accessory (upload on the left). Available for booking/sale:{' '}
                <span className="font-medium text-gray-700">{availableForUse}</span>
                {Number(values.spare_qty) > 0
                  ? ` (${Number(values.spare_qty) || 0} kept as spare)`
                  : ''}
                .
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
            <Button type="button" variant="secondary" onClick={reset}>
              Reset
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {isEdit ? 'Save changes' : isDuplicate ? 'Save duplicate' : 'Submit'}
            </Button>
          </div>
        </form>
      )}
      <CameraCaptureModal
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleImageUpload}
        title="Capture accessory image"
      />
    </>
  );
};

export default AccessoryFormPage;
