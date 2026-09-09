import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { validateFields } from '@wrs/shared';
import { Copy, ArrowLeft, Camera, ImagePlus, Loader2, Plus, Printer, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import InlineAccessoryFormBlock from '../../components/products/InlineAccessoryFormBlock.jsx';
import RelatedProductFormBlock from '../../components/products/RelatedProductFormBlock.jsx';
import Barcode from '../../components/ui/Barcode.jsx';
import Button from '../../components/ui/Button.jsx';
import CameraCaptureModal from '../../components/ui/CameraCaptureModal.jsx';
import Input from '../../components/ui/Input.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import PreviewableUploadThumb from '../../components/ui/PreviewableUploadThumb.jsx';
import Select from '../../components/ui/Select.jsx';
import { accessoriesApi } from '../../lib/api/accessories.js';
import { categoriesApi } from '../../lib/api/categories.js';
import { configurationsApi } from '../../lib/api/configurations.js';
import { sortColorsAZ } from '../../lib/colorOrder.js';
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
import { invalidateCatalogDomain } from '../../lib/queryInvalidation.js';
import {
  buildProductDuplicateDraft,
  normalizeAccessoryMappingsForDuplicate,
} from '../../lib/productDuplicate.js';
import { rejectSubmit } from '../../lib/formValidation.js';
import { toast } from '../../stores/uiStore.js';
import { printBarcodeLabels } from '../../utils/printBarcode.js';
import ProductAccessoryMappingSection from '../../components/products/ProductAccessoryMappingSection.jsx';
import ProductRelatedMappingSection from '../../components/products/ProductRelatedMappingSection.jsx';

const PRODUCT_RULES = {
  name: { required: true, label: 'Name' },
  code: { required: true, label: 'Code' },
  category_id: { required: true, label: 'Category' },
};

const RELATED_PRODUCT_RULES = {
  name: { required: true, label: 'Name' },
  code: { required: true, label: 'Code' },
  category_id: { required: true, label: 'Category' },
};

const ACCESSORY_RULES = {
  name: { required: true, label: 'Accessory name' },
  category_id: { required: true, label: 'Accessory category' },
};

const empty = {
  name: '',
  code: '',
  type: 'rent',
  category_id: '',
  size: '',
  color: '',
  price_rent: 0,
  price_sell: 0,
  qty: 1,
  lifetime_gap: 0,
  count: 0,
  status: 'available',
  notes: '',
  main_image: '',
  photos: [],
};

const emptyAccessory = {
  name: '',
  code: '',
  category_id: '',
  default_type: 'rent',
  default_order_status: 'regular',
  qty: 1,
  spare_qty: 0,
  unit: 'pcs',
  price_rent: 0,
  price_sell: 0,
  purchase_price: 0,
  threshold: 5,
  image_url: '',
  notes: '',
};

const GALLERY_SLOTS = 4;

function newLocalKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const ProductFormPage = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const duplicateFromId = String(searchParams.get('duplicate') || '').trim();
  const isEdit = Boolean(id);
  const isDuplicate = Boolean(duplicateFromId) && !isEdit;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState({});
  const [pendingAccessoryMappings, setPendingAccessoryMappings] = useState([]);
  const pendingAccessoryMappingsRef = useRef([]);
  const [relatedForms, setRelatedForms] = useState([]);
  const [accessoryForms, setAccessoryForms] = useState([]);
  const [batchSaving, setBatchSaving] = useState(false);
  const [uploadingMain, setUploadingMain] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState(-1);
  const [bulkUploading, setBulkUploading] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [codeSuffix, setCodeSuffix] = useState('');
  const [autoFillingCode, setAutoFillingCode] = useState(false);
  const [mainCameraOpen, setMainCameraOpen] = useState(false);
  const [galleryCameraOpen, setGalleryCameraOpen] = useState(false);
  const mainInputRef = useRef(null);
  const bulkInputRef = useRef(null);
  const slotInputsRef = useRef([]);

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ['product', id],
    queryFn: () => productsApi.get(id),
    enabled: isEdit,
  });

  const duplicateQuery = useQuery({
    queryKey: ['product', 'duplicate', duplicateFromId],
    queryFn: async () => {
      const productRes = await productsApi.get(duplicateFromId);
      let mapping = [];
      try {
        const mappingRes = await productsApi.getAccessoryMapping(duplicateFromId);
        mapping = mappingRes?.data?.accessories || [];
      } catch {
        mapping = [];
      }
      return { product: productRes?.data, mapping };
    },
    enabled: isDuplicate,
    retry: false,
  });

  const { data: cats } = useQuery({
    queryKey: ['categories', 'product'],
    queryFn: () => categoriesApi.list({ type: 'product' }),
  });

  const { data: accessoryCats } = useQuery({
    queryKey: ['categories', 'accessory'],
    queryFn: () => categoriesApi.list({ type: 'accessory' }),
    enabled: !isEdit,
  });

  const { data: colorsRes, isLoading: colorsLoading } = useQuery({
    queryKey: ['configurations', 'colors'],
    queryFn: () => configurationsApi.get('colors'),
    staleTime: 60_000,
  });
  const { data: sizesRes, isLoading: sizesLoading } = useQuery({
    queryKey: ['configurations', 'sizes'],
    queryFn: () => configurationsApi.get('sizes'),
    staleTime: 60_000,
  });
  // Memoised so the identity stays stable for the options memo below.
  const colors = useMemo(() => sortColorsAZ(colorsRes?.data?.items), [colorsRes?.data?.items]);
  const sizes = sizesRes?.data?.items || [];

  const { data: codeFormatRes } = useQuery({
    queryKey: ['product-code-format'],
    queryFn: () => productsApi.getCodeFormat(),
    staleTime: 60_000,
  });
  const codeFormat = codeFormatRes?.data;
  const codePadding = Math.max(1, Math.min(10, Number(codeFormat?.padding) || 4));

  const categoryId = values.category_id || '';
  const activePrefix = useMemo(
    () => resolveProductCodePrefixFromFormat(codeFormat, categoryId),
    [codeFormat, categoryId]
  );
  const parsedCode = useMemo(
    () => parseProductCodeSuffix(values.code, activePrefix, codePadding),
    [values.code, activePrefix, codePadding]
  );
  const splitCodeMode = Boolean(activePrefix) && (!isEdit || parsedCode !== null || !values.code);
  const { data: lastCodeRes, isLoading: lastCodeLoading } = useQuery({
    queryKey: ['products', 'last-code', categoryId],
    queryFn: () => productsApi.lastCode({ category_id: categoryId }),
    enabled: Boolean(categoryId),
    staleTime: 30_000,
  });
  const maxCategoryCode = lastCodeRes?.data?.code || null;
  const maxCategoryNumber = lastCodeRes?.data?.max_number ?? null;
  const nextCategoryNumber = lastCodeRes?.data?.next_number ?? null;
  const productSize = values.size || '';
  const nextCategoryCodePreview =
    activePrefix && nextCategoryNumber != null
      ? buildProductCode(activePrefix, nextCategoryNumber, codePadding, productSize)
      : activePrefix
        ? buildProductCode(activePrefix, 1, codePadding, productSize)
        : '';
  const selectedCategoryLabel = useMemo(() => {
    if (!categoryId) return '';
    return (cats?.data || []).find((c) => c.id === categoryId)?.label || '';
  }, [categoryId, cats?.data]);

  const set = (k, v) => {
    setValues((old) => ({ ...old, [k]: v }));
    if (errors[k]) setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const syncSuffixFromCode = (fullCode) => {
    if (!activePrefix || !fullCode) {
      setCodeSuffix('');
      return;
    }
    const parsed = parseProductCodeSuffix(fullCode, activePrefix, codePadding);
    setCodeSuffix(parsed != null ? String(parsed.number) : '');
  };

  const checkCodeNumberTaken = async (sanitizedSuffix, sizeForCheck = productSize) => {
    if (!categoryId || !activePrefix || !sanitizedSuffix) return null;
    const num = Number.parseInt(sanitizedSuffix, 10);
    if (!Number.isFinite(num) || num <= 0) return null;
    try {
      const res = await productsApi.checkCodeNumberTaken({
        category_id: categoryId,
        number: num,
        exclude_id: isEdit ? id : undefined,
        // Same number + different size is allowed (e.g. A-668[36] vs A-668[38]).
        size: String(sizeForCheck ?? '').trim(),
      });
      if (res?.data?.taken) {
        const existing = res.data.existing_code;
        return existing
          ? `Product number ${num} already exists (${existing}).`
          : `Product number ${num} already exists.`;
      }
    } catch {
      return null;
    }
    return null;
  };

  const applyCodeNumberError = (message) => {
    if (message) {
      setErrors((prev) => ({ ...prev, code: message }));
      return;
    }
    setErrors((prev) => {
      if (!prev.code || !String(prev.code).includes('already exists')) return prev;
      const next = { ...prev };
      delete next.code;
      return next;
    });
  };

  const commitCodeSuffix = async (rawSuffix = codeSuffix) => {
    const sanitized = sanitizeCodeSuffixInput(rawSuffix, codePadding);
    setCodeSuffix(sanitized);
    if (!activePrefix) return;
    if (!sanitized) {
      set('code', '');
      applyCodeNumberError(null);
      return;
    }
    const num = Number.parseInt(sanitized, 10);
    if (!Number.isFinite(num)) return;
    set(
      'code',
      normalizeProductCode(buildProductCode(activePrefix, num, codePadding, productSize))
    );
    applyCodeNumberError(await checkCodeNumberTaken(sanitized));
  };

  const initialValues = useMemo(() => {
    if (isEdit && existing?.data) {
      return {
        ...empty,
        ...existing.data,
        code: normalizeProductCode(existing.data.code),
        category_id: existing.data.category_id || '',
        photos: Array.isArray(existing.data.photos) ? existing.data.photos : [],
      };
    }
    return empty;
  }, [isEdit, existing]);

  useEffect(() => {
    if (isDuplicate) return;
    setValues(initialValues);
    if (isEdit && initialValues.code) {
      const prefix = resolveProductCodePrefixFromFormat(codeFormat, initialValues.category_id);
      if (prefix) {
        const parsed = parseProductCodeSuffix(initialValues.code, prefix, codePadding);
        setCodeSuffix(parsed != null ? String(parsed.number) : '');
      } else {
        setCodeSuffix('');
      }
    }
  }, [initialValues, isEdit, isDuplicate, codeFormat, codePadding]);

  useEffect(() => {
    if (!isDuplicate || !duplicateQuery.data?.product) return;
    setValues(buildProductDuplicateDraft(duplicateQuery.data.product));
    setPendingAccessoryMappings(
      normalizeAccessoryMappingsForDuplicate(duplicateQuery.data.mapping)
    );
  }, [isDuplicate, duplicateQuery.data]);

  useEffect(() => {
    pendingAccessoryMappingsRef.current = pendingAccessoryMappings;
  }, [pendingAccessoryMappings]);

  useEffect(() => {
    if (!isDuplicate || !duplicateQuery.isError) return;
    toast.error('Could not load product to duplicate');
    navigate('/products/new', { replace: true });
  }, [isDuplicate, duplicateQuery.isError, navigate]);

  const displayCode = useMemo(() => {
    if (!splitCodeMode || !activePrefix) return values.code;
    const sanitized = sanitizeCodeSuffixInput(codeSuffix, codePadding);
    if (!sanitized) return '';
    const num = Number.parseInt(sanitized, 10);
    if (!Number.isFinite(num)) return values.code;
    return normalizeProductCode(buildProductCode(activePrefix, num, codePadding, productSize));
  }, [splitCodeMode, activePrefix, codeSuffix, codePadding, productSize, values.code]);

  const prevProductSizeRef = useRef(productSize);
  useEffect(() => {
    if (prevProductSizeRef.current === productSize) return;
    prevProductSizeRef.current = productSize;
    if (!splitCodeMode || !activePrefix) return;
    const sanitized = sanitizeCodeSuffixInput(codeSuffix, codePadding);
    if (!sanitized) return;
    const num = Number.parseInt(sanitized, 10);
    if (!Number.isFinite(num)) return;
    const next = normalizeProductCode(
      buildProductCode(activePrefix, num, codePadding, productSize)
    );
    if (next !== values.code) set('code', next);
    if (sanitized) {
      void checkCodeNumberTaken(sanitized).then(applyCodeNumberError);
    }
  }, [productSize, splitCodeMode, activePrefix, codePadding, codeSuffix, values.code]);

  useEffect(() => {
    if (isEdit) return undefined;
    if (!categoryId) {
      set('code', '');
      setCodeSuffix('');
      return undefined;
    }
    if (!activePrefix) {
      set('code', '');
      setCodeSuffix('');
      return undefined;
    }
    let cancelled = false;
    setAutoFillingCode(true);
    productsApi
      .nextCode({ category_id: categoryId, size: productSize })
      .then((res) => {
        if (cancelled) return;
        const code = res?.data?.code;
        if (code) {
          set('code', normalizeProductCode(code));
          syncSuffixFromCode(code);
          queryClient.invalidateQueries({ queryKey: ['products', 'last-code', categoryId] });
        }
      })
      .catch(() => {
        if (!cancelled) toast.error('Could not load next product code');
      })
      .finally(() => {
        if (!cancelled) setAutoFillingCode(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId, isEdit, activePrefix, codePadding]);

  const categoryOptions = useMemo(
    () => (cats?.data || []).map((c) => ({ value: c.id, label: c.label })),
    [cats?.data]
  );
  const accessoryCategoryOptions = useMemo(
    () => (accessoryCats?.data || []).map((c) => ({ value: c.id, label: c.label })),
    [accessoryCats?.data]
  );
  const colorOptions = useMemo(() => colors.map((c) => ({ value: c, label: c })), [colors]);
  const sizeOptions = useMemo(() => sizes.map((s) => ({ value: s, label: s })), [sizes]);

  const buildProductCreateBody = (draft) => {
    const body = {
      ...draft,
      code: normalizeProductCode(draft.code),
      name: normalizeProductName(draft.name),
    };
    if (!body.category_id) body.category_id = null;
    if (!body.main_image) body.main_image = null;
    body.photos = (Array.isArray(draft.photos) ? draft.photos : []).filter(Boolean);
    delete body.count;
    return body;
  };

  const appendRelatedForm = (draft) => {
    setRelatedForms((prev) => [...prev, { key: newLocalKey(), values: draft, errors: {} }]);
  };

  const handleAddProductForm = () => {
    // Blank form — user must pick a different category; code auto-generates after that.
    appendRelatedForm({
      ...empty,
      type: values.type || 'rent',
      category_id: '',
      code: '',
      photos: [],
    });
  };

  const handleDuplicateForm = () => {
    // Copy details but never the same category/code — each related product uses its own category.
    appendRelatedForm({
      ...values,
      category_id: '',
      code: '',
      photos: Array.isArray(values.photos) ? [...values.photos] : [],
      count: 0,
    });
  };

  const getRelatedCategoryOptions = (formKey, currentCategoryId) => {
    const usedByOthers = new Set();
    if (values.category_id) usedByOthers.add(String(values.category_id));
    for (const row of relatedForms) {
      if (row.key === formKey) continue;
      if (row.values.category_id) usedByOthers.add(String(row.values.category_id));
    }
    return categoryOptions.filter(
      (opt) =>
        String(opt.value) === String(currentCategoryId || '') ||
        !usedByOthers.has(String(opt.value))
    );
  };

  const handleAddAccessoryForm = () => {
    setAccessoryForms((prev) => [
      ...prev,
      { key: newLocalKey(), values: { ...emptyAccessory }, errors: {} },
    ]);
  };

  const updateRelatedForm = (key, nextValuesOrFn) => {
    setRelatedForms((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const nextValues =
          typeof nextValuesOrFn === 'function' ? nextValuesOrFn(row.values) : nextValuesOrFn;
        return { ...row, values: nextValues, errors: {} };
      })
    );
  };

  const updateAccessoryForm = (key, nextValues) => {
    setAccessoryForms((prev) =>
      prev.map((row) => (row.key === key ? { ...row, values: nextValues, errors: {} } : row))
    );
  };

  const mutation = useMutation({
    mutationFn: (body) => (isEdit ? productsApi.update(id, body) : productsApi.create(body)),
    onSuccess: async (res) => {
      const newId = res?.data?.id;
      const mappings = pendingAccessoryMappingsRef.current;
      if (!isEdit && mappings.length > 0 && newId) {
        try {
          await productsApi.updateAccessoryMapping(newId, { accessories: mappings });
        } catch (e) {
          toast.error(
            e?.response?.data?.error?.message || 'Product saved but accessory mapping copy failed'
          );
        }
      }
      toast.success(
        isEdit ? 'Product updated' : isDuplicate ? 'Product duplicated' : 'Product created'
      );
      await invalidateCatalogDomain(queryClient, { productId: isEdit ? id : newId });
      navigate('/products');
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

  const submitBatchCreate = async (primaryBody) => {
    setBatchSaving(true);
    try {
      const primaryRes = await productsApi.create(primaryBody);
      const primaryId = primaryRes?.data?.id;
      if (!primaryId) throw new Error('Product create failed');

      const relatedIds = [];
      for (let i = 0; i < relatedForms.length; i += 1) {
        const row = relatedForms[i];
        try {
          const body = buildProductCreateBody(row.values);
          // Auto-generate only when the user left code blank.
          if (body.category_id && !String(body.code || '').trim()) {
            try {
              const codeRes = await productsApi.nextCode({
                category_id: body.category_id,
                size: body.size || '',
              });
              if (codeRes?.data?.code) {
                body.code = normalizeProductCode(codeRes.data.code);
              }
            } catch {
              // Create will fail with a clear validation error if still empty.
            }
          }
          const res = await productsApi.create(body);
          if (res?.data?.id) relatedIds.push(res.data.id);
        } catch (e) {
          const msg =
            e?.response?.data?.error?.message || `Failed to create related product ${i + 1}`;
          toast.error(msg);
          const details = e?.response?.data?.error?.details;
          if (Array.isArray(details)) {
            const fe = {};
            for (const d of details) fe[d.path] = d.message;
            setRelatedForms((prev) => prev.map((r, idx) => (idx === i ? { ...r, errors: fe } : r)));
          }
          await invalidateCatalogDomain(queryClient, { productId: primaryId });
          return;
        }
      }

      const accessoryIds = [];
      for (let i = 0; i < accessoryForms.length; i += 1) {
        const row = accessoryForms[i];
        try {
          const qty = Math.max(0, Number(row.values.qty) || 0);
          const spareQty = Math.max(0, Number(row.values.spare_qty) || 0);
          const body = {
            ...row.values,
            qty,
            spare_qty: Math.min(spareQty, qty),
            default_order_status: row.values.default_order_status || 'regular',
            unit: row.values.unit || 'pcs',
            category_id: row.values.category_id || null,
            image_url: row.values.image_url || null,
            notes: row.values.notes || null,
          };
          if (row.values.code) body.code = normalizeProductCode(row.values.code);
          else delete body.code;
          const res = await accessoriesApi.create(body);
          if (res?.data?.id) accessoryIds.push(res.data.id);
        } catch (e) {
          const msg = e?.response?.data?.error?.message || `Failed to create accessory ${i + 1}`;
          toast.error(msg);
          const details = e?.response?.data?.error?.details;
          if (Array.isArray(details)) {
            const fe = {};
            for (const d of details) fe[d.path] = d.message;
            setAccessoryForms((prev) =>
              prev.map((r, idx) => (idx === i ? { ...r, errors: fe } : r))
            );
          }
          await invalidateCatalogDomain(queryClient, { productId: primaryId });
          return;
        }
      }

      const relatedMappings = relatedIds.map((related_product_id, display_order) => ({
        related_product_id,
        is_recommended: true,
        is_required: false,
        display_order,
      }));
      if (relatedMappings.length > 0) {
        try {
          await productsApi.updateRelatedMapping(primaryId, { products: relatedMappings });
        } catch (e) {
          toast.error(
            e?.response?.data?.error?.message || 'Products created but related mapping failed'
          );
        }
      }

      const accessoryMappings = [
        ...pendingAccessoryMappingsRef.current,
        ...accessoryIds.map((accessory_id, display_order) => ({
          accessory_id,
          is_recommended: true,
          is_required: false,
          display_order: pendingAccessoryMappingsRef.current.length + display_order,
        })),
      ];
      if (accessoryMappings.length > 0) {
        try {
          await productsApi.updateAccessoryMapping(primaryId, { accessories: accessoryMappings });
        } catch (e) {
          toast.error(
            e?.response?.data?.error?.message || 'Products created but accessory mapping failed'
          );
        }
      }

      toast.success(
        relatedIds.length || accessoryIds.length || relatedMappings.length
          ? 'Product and related items created'
          : isDuplicate
            ? 'Product duplicated'
            : 'Product created'
      );
      await invalidateCatalogDomain(queryClient, { productId: primaryId });
      navigate('/products');
    } catch (e) {
      const details = e?.response?.data?.error?.details;
      if (Array.isArray(details)) {
        const fe = {};
        for (const d of details) fe[d.path] = d.message;
        setErrors(fe);
      }
      toast.error(e?.response?.data?.error?.message || e?.message || 'Failed to save');
    } finally {
      setBatchSaving(false);
    }
  };

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

  const handleSlotUpload = async (index, file) => {
    if (!file) return;
    let uploadFile = file;
    try {
      uploadFile = await prepareSingleImageForUpload(file, { title: 'Crop gallery photo' });
    } catch (err) {
      if (isImageCropCancelled(err)) return;
      toast.error(err?.message || 'Could not prepare image');
      const input = slotInputsRef.current[index];
      if (input) input.value = '';
      return;
    }
    setUploadingSlot(index);
    try {
      const { publicUrl } = await uploadToGCS(uploadFile, { folder: 'products' });
      setValues((old) => {
        const next = Array.isArray(old.photos) ? [...old.photos] : [];
        next[index] = publicUrl;
        return { ...old, photos: next };
      });
    } catch (err) {
      toast.error(err?.message || 'Failed to upload image');
    } finally {
      setUploadingSlot(-1);
      const input = slotInputsRef.current[index];
      if (input) input.value = '';
    }
  };

  const handleBulkUpload = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f && f.type?.startsWith('image/'));
    if (!files.length) return;
    const oversized = files.filter((f) => f.size > 25 * 1024 * 1024);
    const uploadable = files.filter((f) => f.size <= 25 * 1024 * 1024);
    if (oversized.length) {
      toast.warning(
        `${oversized.length} image${oversized.length > 1 ? 's' : ''} over 25,600 KB skipped`
      );
    }
    if (!uploadable.length) return;

    setBulkUploading((n) => n + uploadable.length);
    try {
      const results = new Array(uploadable.length);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(2, uploadable.length) }, async () => {
        while (cursor < uploadable.length) {
          const index = cursor;
          cursor += 1;
          try {
            const value = await uploadToGCS(uploadable[index], { folder: 'products' });
            results[index] = { status: 'fulfilled', value };
          } catch (reason) {
            results[index] = { status: 'rejected', reason };
          }
        }
      });
      await Promise.all(workers);

      const uploaded = [];
      let failed = 0;
      for (const r of results) {
        if (r?.status === 'fulfilled' && r.value?.publicUrl) uploaded.push(r.value.publicUrl);
        else failed += 1;
      }
      if (uploaded.length) {
        setValues((old) => ({
          ...old,
          photos: [...(Array.isArray(old.photos) ? old.photos : []), ...uploaded],
        }));
        toast.success(
          uploaded.length === 1 ? 'Image uploaded' : `${uploaded.length} images uploaded`
        );
      }
      if (failed) toast.error(`${failed} image${failed > 1 ? 's' : ''} failed to upload`);
    } finally {
      setBulkUploading((n) => Math.max(0, n - uploadable.length));
      if (bulkInputRef.current) bulkInputRef.current.value = '';
    }
  };

  const handleGalleryCameraCapture = (file) => {
    handleBulkUpload(file ? [file] : []);
  };

  const generateCode = async () => {
    if (!values.category_id) {
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
        category_id: values.category_id,
        size: values.size || '',
      });
      const code = res?.data?.code;
      if (code) {
        set('code', normalizeProductCode(code));
        syncSuffixFromCode(code);
        queryClient.invalidateQueries({ queryKey: ['products', 'last-code', categoryId] });
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

  const removeSlot = (index) => {
    setValues((old) => {
      const next = Array.isArray(old.photos) ? [...old.photos] : [];
      next.splice(index, 1);
      return { ...old, photos: next };
    });
  };

  const reset = () => {
    if (isDuplicate && duplicateQuery.data?.product) {
      setValues(buildProductDuplicateDraft(duplicateQuery.data.product));
      setPendingAccessoryMappings(
        normalizeAccessoryMappingsForDuplicate(duplicateQuery.data.mapping)
      );
    } else {
      setValues(initialValues);
    }
    setErrors({});
    setRelatedForms([]);
    setAccessoryForms([]);
    if (!isDuplicate) setPendingAccessoryMappings([]);
  };

  const submit = async (e) => {
    e.preventDefault();
    let code = values.code;
    if (splitCodeMode && activePrefix) {
      const sanitized = sanitizeCodeSuffixInput(codeSuffix, codePadding);
      if (!sanitized) code = '';
      else {
        const num = Number.parseInt(sanitized, 10);
        if (Number.isFinite(num)) {
          code = normalizeProductCode(
            buildProductCode(activePrefix, num, codePadding, productSize)
          );
        }
      }
    }
    code = normalizeProductCode(code);

    if (splitCodeMode && activePrefix) {
      const sanitized = sanitizeCodeSuffixInput(codeSuffix, codePadding);
      const numberError = sanitized ? await checkCodeNumberTaken(sanitized) : null;
      if (numberError) {
        applyCodeNumberError(numberError);
        toast.warning(numberError);
        return;
      }
    }

    const validationValues = {
      name: values.name,
      code,
      category_id: values.category_id || '',
    };
    const errs = validateFields(validationValues, PRODUCT_RULES);
    if (
      rejectSubmit({ errors: errs, setErrors, toast, message: 'Please fix the highlighted fields' })
    ) {
      return;
    }

    if (!isEdit) {
      const usedCategories = new Set();
      if (values.category_id) usedCategories.add(String(values.category_id));

      let relatedHasError = false;
      const nextRelated = relatedForms.map((row) => {
        const rowErrs = validateFields(
          {
            name: row.values.name,
            code: normalizeProductCode(row.values.code || ''),
            category_id: row.values.category_id || '',
          },
          RELATED_PRODUCT_RULES
        );

        const catId = String(row.values.category_id || '');
        if (catId) {
          if (usedCategories.has(catId)) {
            rowErrs.category_id = 'Use a different category for each product';
          } else {
            usedCategories.add(catId);
          }
        }
        if (Object.keys(rowErrs).length) relatedHasError = true;
        return { ...row, errors: rowErrs };
      });
      if (relatedHasError) {
        setRelatedForms(nextRelated);
        toast.warning('Each additional product needs its own category. Codes are auto-generated.');
        return;
      }

      let accessoryHasError = false;
      const nextAccessories = accessoryForms.map((row) => {
        const rowErrs = validateFields(
          {
            name: row.values.name,
            category_id: row.values.category_id || '',
          },
          ACCESSORY_RULES
        );
        if (Object.keys(rowErrs).length) accessoryHasError = true;
        return { ...row, errors: rowErrs };
      });
      if (accessoryHasError) {
        setAccessoryForms(nextAccessories);
        toast.warning('Please fix the highlighted accessory fields');
        return;
      }
    }

    const body = buildProductCreateBody({
      ...values,
      code: normalizeProductCode(code),
      name: normalizeProductName(values.name),
    });

    if (!isEdit) {
      await submitBatchCreate(body);
      return;
    }
    mutation.mutate(body);
  };

  const title = isEdit ? 'Edit Product' : isDuplicate ? 'Duplicate product' : 'Create Product';
  const description = isEdit
    ? 'Update product details for your catalog.'
    : isDuplicate
      ? 'Review and save a copy of this catalog item.'
      : 'Add a new item to your rental or sale catalog.';

  const photos = Array.isArray(values.photos) ? values.photos : [];
  const slots = Array.from({ length: Math.max(GALLERY_SLOTS, photos.length + 1) });

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate('/products')}>
            Back to products
          </Button>
        }
      />

      {(isEdit && loadingExisting) || (isDuplicate && duplicateQuery.isLoading) ? (
        <div className="card p-6 text-sm text-gray-500">
          {isDuplicate ? 'Loading product to duplicate…' : 'Loading product…'}
        </div>
      ) : (
        <form onSubmit={submit} className="card p-5">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Main image (left) */}
            <div className="w-full lg:w-56 flex-shrink-0">
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
                    <ImagePlus size={36} strokeWidth={1.5} />
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
                  disabled={uploadingMain || bulkUploading > 0}
                >
                  Device
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  icon={Camera}
                  onClick={() => setMainCameraOpen(true)}
                  disabled={uploadingMain || bulkUploading > 0}
                >
                  Camera
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-gray-500 leading-snug">
                Photos are quality-optimized to a target of 500-700 KB before upload.
              </p>
            </div>

            {/* Fields (right) */}
            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3">
                <Select
                  label="Category"
                  required
                  value={values.category_id || ''}
                  onChange={(e) => set('category_id', e.target.value)}
                  placeholder="Select"
                  options={(cats?.data || []).map((c) => ({ value: c.id, label: c.label }))}
                  error={errors.category_id}
                />
                <Input
                  label="Product Name"
                  required
                  placeholder="Product Name"
                  value={values.name}
                  onChange={(e) => set('name', String(e.target.value ?? '').toUpperCase())}
                  onBlur={(e) => set('name', normalizeProductName(e.target.value))}
                  error={errors.name}
                  className="col-span-2"
                />
                <Select
                  label="Color"
                  value={values.color || ''}
                  onChange={(e) => set('color', e.target.value)}
                  placeholder={colorsLoading ? 'Loading…' : 'Select'}
                  options={colors.map((c) => ({ value: c, label: c }))}
                  disabled={colorsLoading}
                  hint={
                    !colorsLoading && colors.length === 0
                      ? 'No colors configured yet for this shop.'
                      : undefined
                  }
                />
                <Select
                  label="Size"
                  value={values.size || ''}
                  onChange={(e) => set('size', e.target.value)}
                  placeholder={sizesLoading ? 'Loading…' : 'Select'}
                  options={sizes.map((s) => ({ value: s, label: s }))}
                  disabled={sizesLoading}
                  hint={
                    !sizesLoading && sizes.length === 0
                      ? 'No sizes configured yet for this shop.'
                      : undefined
                  }
                />
                <Select
                  label="Type"
                  value={values.type}
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
                  value={values.price_rent}
                  onChange={(e) =>
                    set('price_rent', e.target.value === '' ? '' : Number(e.target.value))
                  }
                  error={errors.price_rent}
                />
                <Input
                  label="Sell Price"
                  type="number"
                  step="0.01"
                  value={values.price_sell}
                  onChange={(e) =>
                    set('price_sell', e.target.value === '' ? '' : Number(e.target.value))
                  }
                />
                <div>
                  <label htmlFor="product-code-input" className="label">
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
                        id="product-code-input"
                        required
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder={String(1).padStart(codePadding, '0')}
                        value={codeSuffix}
                        onChange={(e) =>
                          setCodeSuffix(sanitizeCodeSuffixInput(e.target.value, codePadding))
                        }
                        onBlur={(e) => void commitCodeSuffix(e.target.value)}
                        disabled={!categoryId}
                        className={`input flex-1 font-mono ${errors.code ? 'border-red-400 focus:border-red-500 focus:ring-red-400' : ''}`}
                      />
                      <button
                        type="button"
                        onClick={generateCode}
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
                  ) : (
                    <div className="flex gap-1">
                      <input
                        id="product-code-input"
                        required
                        placeholder="Code"
                        value={values.code}
                        onChange={(e) => set('code', normalizeProductCode(e.target.value))}
                        onBlur={(e) => set('code', normalizeProductCode(e.target.value))}
                        className={`input flex-1 ${errors.code ? 'border-red-400 focus:border-red-500 focus:ring-red-400' : ''}`}
                      />
                      <button
                        type="button"
                        onClick={generateCode}
                        disabled={generatingCode || !categoryId || !activePrefix}
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
                          <span className="font-mono font-medium text-brand">
                            {nextCategoryCodePreview}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {errors.code ? (
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
                  value={values.qty}
                  onChange={(e) => set('qty', e.target.value === '' ? '' : Number(e.target.value))}
                />
                <Input
                  label="Lifetime Gap"
                  type="number"
                  min={0}
                  value={values.lifetime_gap}
                  onChange={(e) =>
                    set('lifetime_gap', e.target.value === '' ? '' : Number(e.target.value))
                  }
                  hint="Maximum number of times this product can be rented (0 = unlimited)."
                />
                <Input
                  label="Current Count"
                  type="number"
                  value={values.count || 0}
                  readOnly
                  disabled
                  hint="Number of times this product has been rented (auto-updated)."
                  className="bg-gray-50"
                />
              </div>

              {/* Barcode preview + print */}
              <div className="mt-4">
                <div className="label">Barcode</div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-center justify-center overflow-visible bg-white rounded px-3 py-3 min-w-[180px]">
                    {(splitCodeMode ? displayCode : values.code) ? (
                      <Barcode
                        value={splitCodeMode ? displayCode : values.code}
                        height={56}
                        fontSize={12}
                        margin={10}
                        className="max-w-full overflow-visible"
                      />
                    ) : (
                      <span className="text-xs text-gray-400">
                        Enter or generate a Code to preview
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-xs text-gray-600 space-y-1">
                    <div>
                      <span className="text-gray-500">Value: </span>
                      <span className="font-mono text-gray-800">
                        {(splitCodeMode ? displayCode : values.code) || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Format: </span>
                      <span className="text-gray-800">CODE128</span>
                    </div>
                    <p className="text-gray-500 pt-1">
                      Barcode is generated from the product code — not stored separately.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      icon={Printer}
                      disabled={!(splitCodeMode ? displayCode : values.code)}
                      onClick={() => {
                        try {
                          printBarcodeLabels({
                            value: splitCodeMode ? displayCode : values.code,
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
                <label className="label" htmlFor="product-design-details">
                  Design Details
                </label>
                <textarea
                  id="product-design-details"
                  className="input min-h-[80px]"
                  placeholder="Describe the product design"
                  value={values.notes || ''}
                  onChange={(e) => set('notes', e.target.value)}
                />
              </div>

              <div className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <label className="label mb-0">
                    Images
                    {photos.length ? (
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        {photos.length} selected
                      </span>
                    ) : null}
                    {bulkUploading > 0 ? (
                      <span className="ml-2 text-xs font-normal text-brand">
                        Compressing / uploading {bulkUploading}…
                      </span>
                    ) : null}
                  </label>
                  <input
                    ref={bulkInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handleBulkUpload(e.target.files)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={Plus}
                    onClick={() => bulkInputRef.current?.click()}
                    loading={bulkUploading > 0}
                    disabled={uploadingMain || bulkUploading > 0}
                  >
                    Upload multiple
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={Camera}
                    onClick={() => setGalleryCameraOpen(true)}
                  >
                    Camera
                  </Button>
                </div>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!isDragging) setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    handleBulkUpload(e.dataTransfer.files);
                  }}
                  className={`flex flex-wrap gap-3 rounded-lg p-2 border border-dashed transition ${
                    isDragging ? 'border-brand bg-brand-light/40' : 'border-transparent'
                  }`}
                >
                  {slots.map((_, idx) => {
                    const url = photos[idx];
                    const isUploading = uploadingSlot === idx;
                    return (
                      <div key={idx} className="relative">
                        <input
                          ref={(el) => {
                            slotInputsRef.current[idx] = el;
                          }}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleSlotUpload(idx, e.target.files?.[0])}
                        />
                        <button
                          type="button"
                          onClick={() => slotInputsRef.current[idx]?.click()}
                          className="relative w-24 h-24 rounded-lg border border-dashed border-sky-200 bg-white hover:border-brand hover:bg-sky-50/80 overflow-hidden flex items-center justify-center p-1 transition"
                          aria-label={`Upload image ${idx + 1}`}
                        >
                          {url ? (
                            <img
                              src={url}
                              alt={`Product ${idx + 1}`}
                              className="max-h-full max-w-full object-contain"
                            />
                          ) : (
                            <ImagePlus size={22} className="text-gray-400" strokeWidth={1.5} />
                          )}
                          {isUploading ? (
                            <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                              <Loader2 className="animate-spin text-brand" size={18} />
                            </div>
                          ) : null}
                        </button>
                        {url ? (
                          <button
                            type="button"
                            onClick={() => removeSlot(idx)}
                            className="absolute -top-1.5 -right-1.5 bg-white border border-gray-200 rounded-full p-0.5 text-gray-500 hover:text-red-600 hover:border-red-300 shadow-sm"
                            aria-label="Remove image"
                          >
                            <X size={12} />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}

                  {/* Add more (multi-select) tile */}
                  <button
                    type="button"
                    onClick={() => bulkInputRef.current?.click()}
                    className="relative w-24 h-24 rounded-lg border border-dashed border-sky-200 bg-white hover:border-brand hover:bg-sky-50/80 flex flex-col items-center justify-center text-gray-500 hover:text-brand transition"
                    aria-label="Upload multiple images"
                    disabled={bulkUploading > 0}
                  >
                    {bulkUploading > 0 ? (
                      <>
                        <Loader2 className="animate-spin" size={20} />
                        <span className="text-[11px] mt-1">Uploading…</span>
                      </>
                    ) : (
                      <>
                        <Plus size={20} />
                        <span className="text-[11px] mt-1 leading-tight text-center px-1">
                          Add images
                        </span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setGalleryCameraOpen(true)}
                    className="relative w-24 h-24 rounded-lg border border-dashed border-sky-200 bg-white hover:border-brand hover:bg-sky-50/80 flex flex-col items-center justify-center text-gray-500 hover:text-brand transition"
                    aria-label="Capture image from camera"
                    disabled={bulkUploading > 0}
                  >
                    <Camera size={20} />
                    <span className="text-[11px] mt-1 leading-tight text-center px-1">Camera</span>
                  </button>
                </div>

                <p className="mt-1 text-xs text-gray-500">
                  Drag &amp; drop images here, or click a tile to upload. Photos are
                  quality-optimized to a target of 500-700 KB.
                </p>
              </div>
            </div>
          </div>

          {!isEdit ? (
            <div className="mt-6 pt-4 border-t border-gray-100 space-y-6">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">
                      Additional products ({relatedForms.length})
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Each product must use a different category. Codes auto-fill and you can edit
                      them.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      icon={Plus}
                      onClick={handleAddProductForm}
                    >
                      Add product
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      icon={Copy}
                      onClick={handleDuplicateForm}
                    >
                      Duplicate this
                    </Button>
                  </div>
                </div>

                {relatedForms.map((row, index) => (
                  <RelatedProductFormBlock
                    key={row.key}
                    index={index}
                    values={row.values}
                    errors={row.errors}
                    categoryOptions={getRelatedCategoryOptions(row.key, row.values.category_id)}
                    colorOptions={colorOptions}
                    sizeOptions={sizeOptions}
                    colorsLoading={colorsLoading}
                    sizesLoading={sizesLoading}
                    codeFormat={codeFormat}
                    onChange={(next) => updateRelatedForm(row.key, next)}
                    onRemove={() =>
                      setRelatedForms((prev) => prev.filter((r) => r.key !== row.key))
                    }
                  />
                ))}

                {relatedForms.length > 0 ? (
                  <Button type="button" variant="ghost" icon={Plus} onClick={handleAddProductForm}>
                    Add another product
                  </Button>
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">
                      New accessories ({accessoryForms.length})
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Add as many accessories as you need. Each is created and mapped to this
                      product.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    icon={Plus}
                    onClick={handleAddAccessoryForm}
                  >
                    Add accessory
                  </Button>
                </div>

                {accessoryForms.map((row, index) => (
                  <InlineAccessoryFormBlock
                    key={row.key}
                    index={index}
                    values={row.values}
                    errors={row.errors}
                    categoryOptions={accessoryCategoryOptions}
                    onChange={(next) => updateAccessoryForm(row.key, next)}
                    onRemove={() =>
                      setAccessoryForms((prev) => prev.filter((r) => r.key !== row.key))
                    }
                  />
                ))}

                {accessoryForms.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    icon={Plus}
                    onClick={handleAddAccessoryForm}
                  >
                    Add another accessory
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
            <Button type="button" variant="secondary" onClick={reset}>
              Reset
            </Button>
            <Button
              type="submit"
              loading={mutation.isPending || batchSaving}
              disabled={
                uploadingMain ||
                uploadingSlot >= 0 ||
                bulkUploading > 0 ||
                mutation.isPending ||
                batchSaving
              }
              title={
                uploadingMain || uploadingSlot >= 0 || bulkUploading > 0
                  ? 'Wait for image uploads to finish'
                  : undefined
              }
            >
              {isEdit ? 'Save changes' : 'Submit'}
            </Button>
          </div>
        </form>
      )}

      {isEdit && id ? (
        <>
          <ProductRelatedMappingSection productId={id} />
          <ProductAccessoryMappingSection productId={id} />
        </>
      ) : null}
      <CameraCaptureModal
        isOpen={mainCameraOpen}
        onClose={() => setMainCameraOpen(false)}
        onCapture={handleMainUpload}
        title="Capture product image"
      />
      <CameraCaptureModal
        isOpen={galleryCameraOpen}
        onClose={() => setGalleryCameraOpen(false)}
        onCapture={handleGalleryCameraCapture}
        title="Capture product gallery image"
      />
    </>
  );
};

export default ProductFormPage;
