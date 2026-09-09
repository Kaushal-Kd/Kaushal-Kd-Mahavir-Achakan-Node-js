import { useQuery, useQueryClient } from '@tanstack/react-query';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import MultiImageUploader from '../../components/ui/MultiImageUploader.jsx';
import Select from '../../components/ui/Select.jsx';
import { useCustomOrderMutations } from '../../hooks/api/useCustomOrders.js';
import { categoriesApi } from '../../lib/api/categories.js';
import { configurationsApi } from '../../lib/api/configurations.js';
import { sortColorsAZ } from '../../lib/colorOrder.js';
import { productsApi } from '../../lib/api/products.js';
import { toast } from '../../stores/uiStore.js';

function mergeOrderPhotos(order) {
  const design = Array.isArray(order?.design_images) ? order.design_images : [];
  const trial = Array.isArray(order?.trial_images) ? order.trial_images : [];
  const seen = new Set();
  const out = [];
  for (const url of [...design, ...trial]) {
    const s = String(url || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function buildFormFromOrder(order) {
  const photos = mergeOrderPhotos(order);
  return {
    category_id: order?.category_id || '',
    name: String(order?.product_name || order?.design_name || '').trim(),
    code: '',
    color: order?.color || '',
    size: order?.size || '',
    notes: String(order?.design_name || '').trim(),
    photos,
    main_image: photos[0] || '',
  };
}

const CustomOrderProductVerifyModal = ({ order, isOpen, onClose, onCreated, required = false }) => {
  const queryClient = useQueryClient();
  const { createProductMut } = useCustomOrderMutations();
  const [values, setValues] = useState(() => buildFormFromOrder(order));
  const [errors, setErrors] = useState({});
  const [codeTouched, setCodeTouched] = useState(false);

  const { data: categoriesRes } = useQuery({
    queryKey: ['categories', 'product', 'custom-order-verify'],
    queryFn: () => categoriesApi.list({ type: 'product' }),
    enabled: isOpen,
  });

  const { data: colorsRes, isLoading: colorsLoading } = useQuery({
    queryKey: ['configurations', 'colors', 'custom-order-verify'],
    queryFn: () => configurationsApi.get('colors'),
    enabled: isOpen,
  });

  const { data: sizesRes, isLoading: sizesLoading } = useQuery({
    queryKey: ['configurations', 'sizes', 'custom-order-verify'],
    queryFn: () => configurationsApi.get('sizes'),
    enabled: isOpen,
  });

  const categoryId = values.category_id || '';
  const productSize = values.size || '';

  const { data: nextCodeRes, isFetching: nextCodeLoading } = useQuery({
    queryKey: ['products', 'next-code', 'custom-order-verify', categoryId, productSize],
    queryFn: () =>
      productsApi.nextCode({
        category_id: categoryId || undefined,
        size: productSize,
      }),
    enabled: isOpen && Boolean(categoryId),
    staleTime: 0,
  });

  useEffect(() => {
    if (!isOpen || !order) return;
    setValues(buildFormFromOrder(order));
    setErrors({});
    setCodeTouched(false);
  }, [isOpen, order?.id]);

  useEffect(() => {
    if (!isOpen || !categoryId || codeTouched) return;
    const next = nextCodeRes?.data?.code;
    if (next) {
      setValues((v) => ({ ...v, code: next }));
    }
  }, [isOpen, categoryId, productSize, nextCodeRes?.data?.code, codeTouched]);

  const categories = useMemo(() => {
    const arr = categoriesRes?.data || [];
    return [...arr].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [categoriesRes]);

  const colors = sortColorsAZ(colorsRes?.data?.items);
  const sizes = sizesRes?.data?.items || [];

  const set = (key, val) => {
    setValues((old) => ({ ...old, [key]: val }));
    if (errors[key]) setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const validate = () => {
    const next = {};
    if (!values.category_id) next.category_id = 'Category is required';
    if (!values.name?.trim()) next.name = 'Product name is required';
    if (codeTouched && !values.code?.trim()) next.code = 'Product code is required';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleCategoryChange = (nextCategoryId) => {
    setCodeTouched(false);
    set('category_id', nextCategoryId);
  };

  const handleSizeChange = (nextSize) => {
    setCodeTouched(false);
    set('size', nextSize);
  };

  const handleCodeChange = (nextCode) => {
    setCodeTouched(true);
    set('code', nextCode);
  };

  const handleSave = () => {
    if (!order?.id || createProductMut.isPending) return;
    if (!validate()) {
      toast.warning('Fix the highlighted fields');
      return;
    }
    const photos = Array.isArray(values.photos) ? values.photos.filter(Boolean) : [];
    const mainImage =
      values.main_image && photos.includes(values.main_image)
        ? values.main_image
        : photos[0] || null;

    const body = {
      category_id: values.category_id,
      name: values.name.trim(),
      color: values.color?.trim() || null,
      size: values.size?.trim() || null,
      notes: values.notes?.trim() || null,
      photos,
      main_image: mainImage,
      qty: 1,
      type: 'rent',
    };
    if (codeTouched && values.code?.trim()) {
      body.code = values.code.trim();
      body.code_is_manual = true;
    }

    createProductMut.mutate(
      {
        id: order.id,
        body,
      },
      {
        onSuccess: async (result) => {
          const code = result?.custom_order?.generated_product_code || values.code;
          await queryClient.invalidateQueries({ queryKey: ['products', 'next-code'] });
          if (values.category_id) {
            await queryClient.invalidateQueries({
              queryKey: ['products', 'last-code', values.category_id],
            });
          }
          toast.success(`Product ${code} created`);
          onCreated?.(result?.custom_order || order);
          onClose?.();
        },
        onError: (e) =>
          toast.error(e.response?.data?.error?.message || e?.message || 'Could not create product'),
      }
    );
  };

  if (!order) return null;

  const modalTitle = required ? 'Create product' : 'Review product details';
  const saveLabel = required ? 'Create product' : 'Save and create product';

  return (
    <Modal
      isOpen={isOpen}
      onClose={required ? undefined : onClose}
      title={modalTitle}
      size="lg"
      closeOnBackdrop={!required}
      closeOnEscape={!required}
      showCloseButton={!required}
      footer={
        <>
          {!required ? (
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={createProductMut.isPending}
            >
              Cancel
            </Button>
          ) : null}
          <Button type="button" loading={createProductMut.isPending} onClick={handleSave}>
            {saveLabel}
          </Button>
        </>
      }
    >
      <p className="text-xs text-gray-600 mb-3">
        {required ? (
          <>
            Order <span className="font-mono">{order.order_number}</span> saved. Create the
            inventory product to finish.
          </>
        ) : (
          <>
            Order <span className="font-mono">{order.order_number}</span>. Review the product
            fields below before adding to inventory.
          </>
        )}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select
          label="Category"
          required
          className="sm:col-span-2"
          value={values.category_id}
          onChange={(e) => handleCategoryChange(e.target.value)}
          options={[
            { value: '', label: 'Select category' },
            ...categories.map((c) => ({ value: c.id, label: c.label })),
          ]}
          error={errors.category_id}
        />
        <Input
          label="Product name"
          required
          className="sm:col-span-2"
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />
        <Input
          label="Product code"
          required
          value={values.code}
          onChange={(e) => handleCodeChange(e.target.value)}
          disabled={!codeTouched && nextCodeLoading && Boolean(categoryId)}
          hint={
            categoryId && nextCodeLoading && !codeTouched
              ? 'Loading next code…'
              : 'Auto-generated from category; edit only if you need a custom code.'
          }
          error={errors.code}
        />
        <Input label="Qty" value="1" disabled />
        <Select
          label="Color"
          value={values.color || ''}
          onChange={(e) => set('color', e.target.value)}
          options={[
            { value: '', label: colorsLoading ? 'Loading…' : 'Select' },
            ...colors.map((c) => ({ value: c, label: c })),
          ]}
          disabled={colorsLoading}
        />
        <Select
          label="Size"
          value={values.size || ''}
          onChange={(e) => handleSizeChange(e.target.value)}
          options={[
            { value: '', label: sizesLoading ? 'Loading…' : 'Select' },
            ...sizes.map((s) => ({ value: s, label: s })),
          ]}
          disabled={sizesLoading}
        />
        <Input
          label="Notes"
          className="sm:col-span-2"
          value={values.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
        <div className="sm:col-span-2">
          <MultiImageUploader
            label="Photos"
            hint="Design and trial images from the order; adjust before saving."
            folder="products"
            value={values.photos}
            onChange={(photos) => {
              setValues((v) => ({
                ...v,
                photos,
                main_image:
                  v.main_image && photos.includes(v.main_image) ? v.main_image : photos[0] || '',
              }));
            }}
          />
          {values.photos?.length > 1 ? (
            <Select
              label="Main image"
              className="mt-2"
              value={values.main_image || ''}
              onChange={(e) => set('main_image', e.target.value)}
              options={values.photos.map((url) => ({ value: url, label: url.split('/').pop() || url }))}
            />
          ) : null}
        </div>
      </div>
    </Modal>
  );
};

CustomOrderProductVerifyModal.propTypes = {
  order: PropTypes.shape({
    id: PropTypes.string,
    order_number: PropTypes.string,
    category_id: PropTypes.string,
    product_name: PropTypes.string,
    design_name: PropTypes.string,
    color: PropTypes.string,
    size: PropTypes.string,
    design_images: PropTypes.arrayOf(PropTypes.string),
    trial_images: PropTypes.arrayOf(PropTypes.string),
  }),
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  onCreated: PropTypes.func,
  required: PropTypes.bool,
};

export default CustomOrderProductVerifyModal;
