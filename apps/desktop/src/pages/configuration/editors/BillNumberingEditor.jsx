import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ORDER_NUMBER_FORMAT,
  ORDER_NUMBER_FORMATS,
  ORDER_NUMBER_PREFIX_MAX,
  buildOrderNumber,
  normalizeOrderNumberFormat,
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

const BillNumberingEditor = () => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['config-bill-numbering'],
    queryFn: () => configurationsApi.getBillNumbering(),
  });
  const serverPrefix = data?.data?.order_number_prefix ?? '';
  const serverFormat = normalizeOrderNumberFormat(data?.data?.order_number_format);
  const [prefixInput, setPrefixInput] = useState('');
  const [formatInput, setFormatInput] = useState(ORDER_NUMBER_FORMAT.PREFIX_SEQUENCE);

  useEffect(() => {
    setPrefixInput(serverPrefix || '');
  }, [serverPrefix]);

  useEffect(() => {
    setFormatInput(serverFormat);
  }, [serverFormat]);

  const normalizedLocal = useMemo(() => {
    const s = String(prefixInput ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, ORDER_NUMBER_PREFIX_MAX);
    return s;
  }, [prefixInput]);

  const normalizedFormat = useMemo(() => normalizeOrderNumberFormat(formatInput), [formatInput]);

  const isDirty =
    normalizedLocal !== (serverPrefix || '') || normalizedFormat !== serverFormat;

  const previewLive = useMemo(
    () =>
      buildOrderNumber({
        format: normalizedFormat,
        prefix: normalizedLocal || 'O',
        sequence: 1,
        previewDate: todayIndiaISODate(),
      }),
    [normalizedFormat, normalizedLocal]
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
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config-bill-numbering'] });
      toast.success('Bill numbering saved');
    },
    onError: (e) => toast.error(e.response?.data?.error?.message || e.response?.data?.message || 'Save failed'),
  });

  return (
    <Section
      title="Bill numbering"
      description="How new rental booking bill numbers are generated for this shop. Existing bookings keep their saved numbers."
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
        <div className="max-w-md space-y-3">
          <Select
            label="Bill number format"
            value={normalizedFormat}
            onChange={(e) => setFormatInput(e.target.value)}
            options={ORDER_NUMBER_FORMATS.map((f) => ({
              value: f.value,
              label: `${f.label} (e.g. ${f.example})`,
            }))}
          />
          <Input
            label="Bill / order number prefix"
            value={prefixInput}
            onChange={(e) => setPrefixInput(e.target.value)}
            hint={`Letters and numbers only, up to ${ORDER_NUMBER_PREFIX_MAX} characters. Leave empty to use the default O. Used for prefix-based formats.`}
            placeholder="e.g. O or MAHAVIR"
          />
          <div className="text-xs text-gray-600 rounded border border-gray-200 bg-gray-50 px-3 py-2">
            <span className="font-medium text-gray-700">Preview (today&apos;s date, sequence 1):</span>{' '}
            <span className="font-mono text-gray-900">{previewLive}</span>
            <span className="text-gray-500 block mt-1">
              {FORMAT_HINTS[normalizedFormat] || FORMAT_HINTS[ORDER_NUMBER_FORMAT.PREFIX_SEQUENCE]}
            </span>
            <span className="text-gray-500 block mt-1">
              Example pattern: <span className="font-mono">{selectedFormatMeta.example}</span>
            </span>
          </div>
        </div>
      )}
    </Section>
  );
};

export default BillNumberingEditor;
