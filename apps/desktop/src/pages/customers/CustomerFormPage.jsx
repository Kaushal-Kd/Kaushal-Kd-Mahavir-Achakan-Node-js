import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { phoneInputDigits, validateFields } from '@wrs/shared';
import clsx from 'clsx';
import { ArrowLeft, ImagePlus, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import PreviewableUploadThumb from '../../components/ui/PreviewableUploadThumb.jsx';
import { customersApi } from '../../lib/api/customers.js';
import { uploadToGCS } from '../../services/gcsUpload.js';
import {
  isImageCropCancelled,
  prepareSingleImageForUpload,
} from '../../services/imagePickWithCrop.js';
import { invalidateCustomersDomain } from '../../lib/queryInvalidation.js';
import { toast } from '../../stores/uiStore.js';

/** Guess how WhatsApp was stored: same as phone1, phone2, or a custom number. */
function inferWhatsappSource(data) {
  const w = phoneInputDigits(data.whatsapp);
  const p1 = phoneInputDigits(data.phone1);
  const p2 = phoneInputDigits(data.phone2);
  if (!w) return 'phone1';
  if (w === p1) return 'phone1';
  if (p2.length === 10 && w === p2) return 'phone2';
  return 'manual';
}

function resolveWhatsapp(values, source) {
  const p1 = phoneInputDigits(values.phone1);
  const p2 = phoneInputDigits(values.phone2);
  if (source === 'phone1') return p1 || '';
  if (source === 'phone2') {
    if (p2.length !== 10) return '';
    return p2;
  }
  return phoneInputDigits(values.whatsapp);
}

const empty = {
  name: '',
  phone1: '',
  phone1_name: '',
  phone2: '',
  phone2_name: '',
  whatsapp: '',
  email: '',
  address: '',
  notes: '',
  photo_url: '',
};

const RULES = {
  name: { required: true, label: 'Name' },
  phone1: { type: 'phone', required: true, label: 'Phone 1' },
  phone2: { type: 'phone', label: 'Phone 2' },
  whatsapp: { type: 'phone', label: 'WhatsApp' },
  email: { type: 'email', label: 'Email' },
};

const CustomerFormPage = () => {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const returnTo = searchParams.get('returnTo') || '';

  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [phone2SameAsPhone1, setPhone2SameAsPhone1] = useState(false);
  /** Where WhatsApp number comes from: phone1 | phone2 | manual (not stored on server). */
  const [whatsappSource, setWhatsappSource] = useState('phone1');
  const [uploadingMain, setUploadingMain] = useState(false);
  const mainInputRef = useRef(null);

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => customersApi.get(id),
    enabled: isEdit,
  });

  const initialValues = useMemo(() => {
    if (isEdit && existing?.data) {
      return {
        ...empty,
        ...existing.data,
        photo_url: existing.data.photo_url || '',
      };
    }
    return empty;
  }, [isEdit, existing]);

  useEffect(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
    setPhone2SameAsPhone1(
      phoneInputDigits(initialValues.phone1).length > 0 &&
        phoneInputDigits(initialValues.phone1) === phoneInputDigits(initialValues.phone2)
    );
    setWhatsappSource(inferWhatsappSource(initialValues));
  }, [initialValues]);

  useEffect(() => {
    if (!phone2SameAsPhone1) return;
    setValues((prev) => ({
      ...prev,
      phone2: phoneInputDigits(prev.phone1),
      phone2_name: String(prev.phone1_name || ''),
    }));
  }, [phone2SameAsPhone1, values.phone1, values.phone1_name]);

  const valuesForValidation = useMemo(() => {
    const v = { ...values };
    v.phone1 = phoneInputDigits(v.phone1);
    v.phone2 = phoneInputDigits(v.phone2);
    // Only validate whatsapp field when user types it manually (avoids double errors with Phone 1).
    v.whatsapp = whatsappSource === 'manual' ? phoneInputDigits(values.whatsapp) : '';
    return v;
  }, [values, whatsappSource]);

  const liveErrors = useMemo(() => validateFields(valuesForValidation, RULES), [valuesForValidation]);

  const mutation = useMutation({
    mutationFn: (body) => (isEdit ? customersApi.update(id, body) : customersApi.create(body)),
    onSuccess: async () => {
      toast.success(isEdit ? 'Customer updated' : 'Customer created');
      await invalidateCustomersDomain(queryClient, { customerId: isEdit ? id : undefined });
      navigate(returnTo || '/customers');
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

  const onBlur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));
  const showError = (k) => (touched[k] || errors[k] ? errors[k] || liveErrors[k] : undefined);

  const handleMainUpload = async (file) => {
    if (!file) return;
    let uploadFile = file;
    try {
      uploadFile = await prepareSingleImageForUpload(file, { title: 'Crop customer photo' });
    } catch (err) {
      if (isImageCropCancelled(err)) return;
      toast.error(err?.message || 'Could not prepare image');
      if (mainInputRef.current) mainInputRef.current.value = '';
      return;
    }
    setUploadingMain(true);
    try {
      const { publicUrl } = await uploadToGCS(uploadFile, { folder: 'customers' });
      set('photo_url', publicUrl);
    } catch (err) {
      toast.error(err?.message || 'Failed to upload image');
    } finally {
      setUploadingMain(false);
      if (mainInputRef.current) mainInputRef.current.value = '';
    }
  };

  const reset = () => {
    setValues(initialValues);
    setPhone2SameAsPhone1(
      phoneInputDigits(initialValues.phone1).length > 0 &&
        phoneInputDigits(initialValues.phone1) === phoneInputDigits(initialValues.phone2)
    );
    setWhatsappSource(inferWhatsappSource(initialValues));
    setErrors({});
    setTouched({});
  };

  const submit = (e) => {
    e.preventDefault();
    const allTouched = Object.keys(RULES).reduce((acc, k) => ({ ...acc, [k]: true }), {});
    setTouched(allTouched);

    if (whatsappSource === 'phone2' && phoneInputDigits(values.phone2).length !== 10) {
      toast.error('Enter a valid Phone 2 to use it for WhatsApp.');
      return;
    }

    const errs = validateFields(valuesForValidation, RULES);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error('Please fix the highlighted fields');
      return;
    }

    const p1 = phoneInputDigits(values.phone1);
    const p2 = phoneInputDigits(values.phone2);
    const wa = resolveWhatsapp(values, whatsappSource);

    const body = { ...values };
    body.phone1 = p1;
    body.phone2 = p2 || null;
    body.phone2_name = values.phone2_name?.trim() || null;
    body.whatsapp = wa || null;

    for (const k of Object.keys(body)) {
      if (body[k] === '') body[k] = null;
    }
    body.name = values.name;
    if (!body.photo_url) body.photo_url = null;
    mutation.mutate(body);
  };

  const title = isEdit ? 'Edit customer' : 'New customer';
  const description = isEdit
    ? 'Update customer contact details.'
    : 'Add a customer with contact details.';

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate(returnTo || '/customers')}>
            {returnTo ? 'Back' : 'Back to customers'}
          </Button>
        }
      />

      {isEdit && loadingExisting ? (
        <div className="card p-6 text-sm text-gray-500">Loading customer…</div>
      ) : (
        <form onSubmit={submit} className="card p-5">
          <div className="flex flex-col lg:flex-row gap-6">
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
                  values.photo_url
                    ? 'bg-white hover:border-brand hover:bg-sky-50/80'
                    : 'bg-gray-50 hover:border-brand hover:bg-brand-light/40'
                }`}
                aria-label="Upload main photo"
              >
                {values.photo_url ? (
                  <PreviewableUploadThumb
                    src={values.photo_url}
                    alt="Customer photo"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center text-gray-400">
                    <ImagePlus size={36} strokeWidth={1.5} />
                    <span className="text-xs mt-2">Main photo</span>
                  </div>
                )}
                {uploadingMain ? (
                  <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                    <Loader2 className="animate-spin text-brand" size={22} />
                  </div>
                ) : null}
              </button>
              {values.photo_url ? (
                <button
                  type="button"
                  onClick={() => set('photo_url', '')}
                  className="mt-2 text-left text-xs text-sky-700/80 hover:text-red-600"
                >
                  Remove photo
                </button>
              ) : null}
            </div>

            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3">
                <Input
                  label="Full name"
                  required
                  placeholder="Full name"
                  value={values.name}
                  onChange={(e) => set('name', e.target.value)}
                  onBlur={onBlur('name')}
                  error={showError('name')}
                  className="col-span-2"
                />
                <Input
                  label="Phone 1"
                  required
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10-digit mobile (digits only)"
                  value={values.phone1}
                  onChange={(e) => set('phone1', phoneInputDigits(e.target.value))}
                  onBlur={onBlur('phone1')}
                  error={showError('phone1')}
                />
                <Input
                  label="Phone 1 Name"
                  placeholder="e.g. Self"
                  value={values.phone1_name || ''}
                  onChange={(e) => set('phone1_name', e.target.value)}
                />
                <div>
                  <Input
                    label="Phone 2"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10-digit mobile (digits only)"
                    value={values.phone2 || ''}
                    onChange={(e) => set('phone2', phoneInputDigits(e.target.value))}
                    onBlur={onBlur('phone2')}
                    error={showError('phone2')}
                    disabled={phone2SameAsPhone1}
                  />
                  <label className="mt-1 inline-flex items-center gap-2 text-[11px] text-gray-600">
                    <input
                      type="checkbox"
                      checked={phone2SameAsPhone1}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setPhone2SameAsPhone1(on);
                        if (on) {
                          setValues((prev) => ({
                            ...prev,
                            phone2: phoneInputDigits(prev.phone1),
                            phone2_name: String(prev.phone1_name || ''),
                          }));
                        }
                      }}
                      disabled={!phoneInputDigits(values.phone1)}
                    />
                    Same as Phone Number 1
                  </label>
                </div>
                <Input
                  label="Phone 2 Name"
                  placeholder="e.g. Father"
                  value={values.phone2_name || ''}
                  onChange={(e) => set('phone2_name', e.target.value)}
                  disabled={phone2SameAsPhone1}
                />
                <div className="col-span-2 md:col-span-4 space-y-2">
                  <span className="label">WhatsApp number</span>
                  <p className="text-[11px] text-gray-500 -mt-1">
                    Use the same number as Phone 1, Phone 2, or type a different number.
                  </p>
                  <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                    {[
                      { id: 'wa-p1', value: 'phone1', label: 'Same as Phone 1' },
                      {
                        id: 'wa-p2',
                        value: 'phone2',
                        label: 'Same as Phone 2',
                        disabled: phoneInputDigits(values.phone2).length !== 10,
                      },
                      { id: 'wa-man', value: 'manual', label: 'Enter manually' },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={clsx(
                          'inline-flex items-center gap-2 cursor-pointer rounded-md border px-3 py-2 text-sm transition',
                          whatsappSource === opt.value
                            ? 'border-brand bg-brand-light text-brand font-medium'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300',
                          opt.disabled && 'opacity-50 cursor-not-allowed pointer-events-none'
                        )}
                      >
                        <input
                          type="radio"
                          name="whatsapp-source"
                          className="sr-only"
                          checked={whatsappSource === opt.value}
                          disabled={opt.disabled}
                          onChange={() => setWhatsappSource(opt.value)}
                        />
                        <span
                          className={clsx(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                            whatsappSource === opt.value ? 'border-brand' : 'border-gray-300'
                          )}
                          aria-hidden
                        >
                          {whatsappSource === opt.value ? (
                            <span className="h-2 w-2 rounded-full bg-brand" />
                          ) : null}
                        </span>
                        {opt.label}
                      </label>
                    ))}
                  </div>
                  {whatsappSource === 'phone1' ? (
                    <p className="text-xs text-gray-600">
                      WhatsApp:{' '}
                      <span className="font-mono font-medium text-gray-900">
                        {phoneInputDigits(values.phone1) || '—'}
                      </span>
                      {phoneInputDigits(values.phone1).length > 0 &&
                      phoneInputDigits(values.phone1).length < 10 ? (
                        <span className="text-amber-600"> (complete 10 digits)</span>
                      ) : null}
                    </p>
                  ) : null}
                  {whatsappSource === 'phone2' ? (
                    <p className="text-xs text-gray-600">
                      WhatsApp:{' '}
                      <span className="font-mono font-medium text-gray-900">
                        {phoneInputDigits(values.phone2) || '—'}
                      </span>
                    </p>
                  ) : null}
                  {whatsappSource === 'manual' ? (
                    <Input
                      label="WhatsApp (digits only)"
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="10-digit mobile"
                      value={values.whatsapp || ''}
                      onChange={(e) => set('whatsapp', phoneInputDigits(e.target.value))}
                      onBlur={onBlur('whatsapp')}
                      error={showError('whatsapp')}
                      className="max-w-xs"
                    />
                  ) : null}
                </div>
                <div className="col-span-2 md:col-span-2">
                  <Input
                    label="Email"
                    type="email"
                    value={values.email || ''}
                    onChange={(e) => set('email', e.target.value)}
                    onBlur={onBlur('email')}
                    error={showError('email')}
                  />
                </div>
                <Input
                  label="Address"
                  className="col-span-2 md:col-span-4"
                  value={values.address || ''}
                  onChange={(e) => set('address', e.target.value)}
                />
              </div>

              <div className="mt-4">
                <label htmlFor="customer-notes" className="label">Notes</label>
                <textarea
                  id="customer-notes"
                  className="input min-h-[80px]"
                  placeholder="Type your notes here"
                  value={values.notes || ''}
                  onChange={(e) => set('notes', e.target.value)}
                />
              </div>

            </div>
          </div>

          <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
            <Button type="button" variant="secondary" onClick={reset}>
              Reset
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {isEdit ? 'Save changes' : 'Create customer'}
            </Button>
          </div>
        </form>
      )}
    </>
  );
};

export default CustomerFormPage;
