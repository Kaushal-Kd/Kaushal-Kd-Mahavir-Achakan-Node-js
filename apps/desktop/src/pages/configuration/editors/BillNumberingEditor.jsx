import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DOCUMENT_NUMBER_TYPES,
  ORDER_NUMBER_FORMAT,
  ORDER_NUMBER_FORMATS,
  ORDER_NUMBER_PREFIX_MAX,
  buildOrderNumber,
  buildPrefixedDocumentNumber,
  normalizeOrderNumberFormat,
  normalizeOrderNumberPrefix,
  normalizeStartSequence,
  todayIndiaISODate,
} from '@wrs/shared';
import { Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../../components/ui/Button.jsx';
import Input from '../../../components/ui/Input.jsx';
import Select from '../../../components/ui/Select.jsx';
import { configurationsApi } from '../../../lib/api/configurations.js';
import { toast } from '../../../stores/uiStore.js';
import { Section } from '../../settings/tabs/_Tab.jsx';

const FORMAT_HINTS = {
  [ORDER_NUMBER_FORMAT.PREFIX_SEQUENCE]:
    'Prefix plus a four-digit running sequence (unique per shop).',
  [ORDER_NUMBER_FORMAT.DATE_SEQUENCE]:
    'Booking date (YYYYMMDD) plus the global bill sequence (min 2 digits).',
  [ORDER_NUMBER_FORMAT.PREFIX_DATE_SEQUENCE]:
    'Prefix, booking date (YYYYMMDD), and the global bill sequence (min 2 digits).',
};

function emptyDocState() {
  return Object.fromEntries(
    DOCUMENT_NUMBER_TYPES.filter((t) => t.key !== 'booking').map((t) => [
      t.key,
      { prefix: '', start_sequence: '1' },
    ])
  );
}

function sanitizePrefix(raw) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ORDER_NUMBER_PREFIX_MAX);
}

const BillNumberingEditor = () => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['config-bill-numbering'],
    queryFn: () => configurationsApi.getBillNumbering(),
  });
  const server = data?.data || {};
  const serverDocs = server.documents || {};

  const [prefixInput, setPrefixInput] = useState('');
  const [formatInput, setFormatInput] = useState(ORDER_NUMBER_FORMAT.PREFIX_SEQUENCE);
  const [bookingStartInput, setBookingStartInput] = useState('1');
  const [docsInput, setDocsInput] = useState(emptyDocState);

  useEffect(() => {
    const payload = data?.data;
    if (!payload) return;
    const docs = payload.documents || {};
    setPrefixInput(payload.order_number_prefix || '');
    setFormatInput(normalizeOrderNumberFormat(payload.order_number_format));
    setBookingStartInput(String(normalizeStartSequence(payload.order_start_sequence)));
    const next = emptyDocState();
    for (const type of DOCUMENT_NUMBER_TYPES) {
      if (type.key === 'booking') continue;
      const row = docs[type.key] || {};
      next[type.key] = {
        prefix: row.prefix || row.effective_prefix || '',
        start_sequence: String(normalizeStartSequence(row.start_sequence)),
      };
    }
    setDocsInput(next);
  }, [data]);

  const normalizedLocal = useMemo(() => sanitizePrefix(prefixInput), [prefixInput]);
  const normalizedFormat = useMemo(() => normalizeOrderNumberFormat(formatInput), [formatInput]);
  const bookingStart = useMemo(
    () => normalizeStartSequence(bookingStartInput),
    [bookingStartInput]
  );

  const normalizedDocs = useMemo(() => {
    const out = {};
    for (const type of DOCUMENT_NUMBER_TYPES) {
      if (type.key === 'booking') continue;
      const row = docsInput[type.key] || {};
      out[type.key] = {
        prefix: sanitizePrefix(row.prefix),
        start_sequence: normalizeStartSequence(row.start_sequence),
      };
    }
    return out;
  }, [docsInput]);

  const isDirty = useMemo(() => {
    if (normalizedLocal !== (server.order_number_prefix || '')) return true;
    if (normalizedFormat !== normalizeOrderNumberFormat(server.order_number_format)) return true;
    if (bookingStart !== normalizeStartSequence(server.order_start_sequence)) return true;
    for (const type of DOCUMENT_NUMBER_TYPES) {
      if (type.key === 'booking') continue;
      const local = normalizedDocs[type.key];
      const remote = serverDocs[type.key] || {};
      const remotePrefix = remote.prefix || remote.effective_prefix || '';
      if (local.prefix !== remotePrefix) return true;
      if (local.start_sequence !== normalizeStartSequence(remote.start_sequence)) return true;
    }
    return false;
  }, [
    normalizedLocal,
    normalizedFormat,
    bookingStart,
    normalizedDocs,
    server.order_number_prefix,
    server.order_number_format,
    server.order_start_sequence,
    serverDocs,
  ]);

  const bookingPreview = useMemo(
    () =>
      buildOrderNumber({
        format: normalizedFormat,
        prefix: normalizedLocal || 'O',
        sequence: bookingStart,
        previewDate: todayIndiaISODate(),
      }),
    [normalizedFormat, normalizedLocal, bookingStart]
  );

  const selectedFormatMeta = useMemo(
    () => ORDER_NUMBER_FORMATS.find((f) => f.value === normalizedFormat) || ORDER_NUMBER_FORMATS[0],
    [normalizedFormat]
  );

  const saveMut = useMutation({
    mutationFn: () =>
      configurationsApi.updateBillNumbering({
        order_number_prefix: normalizedLocal,
        order_number_format: normalizedFormat,
        order_start_sequence: bookingStart,
        documents: normalizedDocs,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config-bill-numbering'] });
      toast.success('Bill numbering saved');
    },
    onError: (e) =>
      toast.error(e.response?.data?.error?.message || e.response?.data?.message || 'Save failed'),
  });

  const updateDoc = (key, field, value) => {
    setDocsInput((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  return (
    <Section
      title="Bill numbering"
      description="Prefix and starting sequence for every transaction type. Existing bills keep their saved numbers. New bills use this start, or the next unused number if you already passed it."
      actions={
        <Button
          icon={Save}
          size="sm"
          onClick={() => saveMut.mutate()}
          loading={saveMut.isPending}
          disabled={!isDirty}
        >
          Save changes
        </Button>
      }
    >
      {isLoading ? (
        <div className="text-sm text-gray-400 py-4 text-center">Loading…</div>
      ) : (
        <div className="space-y-5">
          <div className="max-w-md">
            <Select
              label="Booking bill number format"
              value={normalizedFormat}
              onChange={(e) => setFormatInput(e.target.value)}
              options={ORDER_NUMBER_FORMATS.map((f) => ({
                value: f.value,
                label: `${f.label} (e.g. ${f.example})`,
              }))}
            />
            <p className="mt-1 text-xs text-gray-500">
              {FORMAT_HINTS[normalizedFormat] || FORMAT_HINTS[ORDER_NUMBER_FORMAT.PREFIX_SEQUENCE]}{' '}
              Example: <span className="font-mono">{selectedFormatMeta.example}</span>
            </p>
          </div>

          <div className="overflow-x-auto rounded border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 w-44">Document</th>
                  <th className="px-3 py-2">Prefix</th>
                  <th className="px-3 py-2 w-40">Start sequence</th>
                  <th className="px-3 py-2">Preview</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <td className="px-3 py-2 font-medium text-gray-800">Bookings</td>
                  <td className="px-3 py-2">
                    <Input
                      value={prefixInput}
                      onChange={(e) => setPrefixInput(e.target.value)}
                      placeholder="e.g. MAHAVIR"
                      inputClassName="h-9"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={1}
                      value={bookingStartInput}
                      onChange={(e) => setBookingStartInput(e.target.value)}
                      inputClassName="h-9"
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-900">{bookingPreview}</td>
                </tr>
                {DOCUMENT_NUMBER_TYPES.filter((t) => t.key !== 'booking').map((type) => {
                  const row = docsInput[type.key] || { prefix: '', start_sequence: '1' };
                  const prefix = sanitizePrefix(row.prefix) || type.defaultPrefix;
                  const start = normalizeStartSequence(row.start_sequence);
                  const preview = buildPrefixedDocumentNumber({ prefix, sequence: start });
                  return (
                    <tr key={type.key}>
                      <td className="px-3 py-2 font-medium text-gray-800">{type.label}</td>
                      <td className="px-3 py-2">
                        <Input
                          value={row.prefix}
                          onChange={(e) => updateDoc(type.key, 'prefix', e.target.value)}
                          placeholder={type.defaultPrefix}
                          inputClassName="h-9"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={1}
                          value={row.start_sequence}
                          onChange={(e) => updateDoc(type.key, 'start_sequence', e.target.value)}
                          inputClassName="h-9"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-900">{preview}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            Letters and numbers only for prefixes, up to {ORDER_NUMBER_PREFIX_MAX} characters. Start
            sequence is the first number for new records of that type (for example 1 → 0001, or 2345
            → 2345).
          </p>
        </div>
      )}
    </Section>
  );
};

export default BillNumberingEditor;
