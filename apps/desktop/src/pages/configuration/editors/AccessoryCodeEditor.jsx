import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../../components/ui/Button.jsx';
import TableHeaderLabel from '../../../components/ui/TableHeaderLabel.jsx';
import Input from '../../../components/ui/Input.jsx';
import { categoriesApi } from '../../../lib/api/categories.js';
import { accessoriesApi } from '../../../lib/api/accessories.js';
import { buildProductCode } from '../../../lib/productCodeFormat.js';
import { guardedMutate } from '../../../lib/guardedMutate.js';
import { toast } from '../../../stores/uiStore.js';
import { Section } from '../../settings/tabs/_Tab.jsx';

const PREFIX_MAX = 40;

const AccessoryCodeEditor = () => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['accessory-code-format'],
    queryFn: () => accessoriesApi.getCodeFormat(),
  });
  const { data: catsRes, isLoading: catsLoading } = useQuery({
    queryKey: ['categories', 'accessory', 'code-format'],
    queryFn: () => categoriesApi.list({ type: 'accessory' }),
  });

  const categories = useMemo(() => {
    const arr = catsRes?.data || [];
    return [...arr].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [catsRes]);

  const [defaultPrefix, setDefaultPrefix] = useState('ACC');
  const [padding, setPadding] = useState(4);
  const [byCategory, setByCategory] = useState({});

  useEffect(() => {
    if (data?.data) {
      const d = data.data;
      setDefaultPrefix(d.default_prefix ?? d.prefix ?? 'ACC');
      setPadding(Number(d.padding) || 4);
      setByCategory(
        d.by_category && typeof d.by_category === 'object' ? { ...d.by_category } : {}
      );
    }
  }, [data]);

  const pad = Math.max(1, Math.min(10, Number(padding) || 4));

  const saveMut = useMutation({
    mutationFn: () =>
      accessoriesApi.updateCodeFormat({
        default_prefix: defaultPrefix.trim().slice(0, PREFIX_MAX),
        padding: pad,
        by_category: byCategory,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accessory-code-format'] });
      toast.success('Accessory code format saved');
    },
    onError: (e) => toast.error(e.response?.data?.error?.message || 'Save failed'),
  });

  const setCategoryPrefix = (categoryId, value) => {
    setByCategory((prev) => ({
      ...prev,
      [categoryId]: value.slice(0, PREFIX_MAX),
    }));
  };

  const previewForPrefix = (prefix) => {
    const p = prefix || defaultPrefix || '';
    return p ? buildProductCode(p, 1, pad, '') : '—';
  };

  return (
    <Section
      title="Accessories"
      description="Per-category prefixes and shared number padding for auto-generated accessory codes (unique per shop)."
      actions={
        <Button
          icon={Save}
          size="sm"
          onClick={() => guardedMutate(saveMut)}
          loading={saveMut.isPending}
          disabled={isLoading || catsLoading}
        >
          Save changes
        </Button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Input
          label="Default prefix"
          placeholder="e.g. ACC- (uncategorized or categories without a prefix)"
          value={defaultPrefix}
          onChange={(e) => setDefaultPrefix(e.target.value)}
          hint="Used when a category has no prefix configured."
        />
        <Input
          label="Number padding"
          type="number"
          min={1}
          max={10}
          value={padding}
          onChange={(e) => setPadding(e.target.value === '' ? '' : Number(e.target.value))}
          hint="Zero-pad the incrementing number (e.g. 4 → 0001). Full code: prefix + number."
        />
      </div>

      <div className="rounded-md border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-800">Prefix by accessory category</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Each category can have its own prefix (e.g. MOJDI-, SAFA-). Codes auto-fill on the
            accessory form.
          </p>
        </div>
        {catsLoading ? (
          <div className="px-3 py-6 text-sm text-gray-400 text-center">Loading categories…</div>
        ) : categories.length === 0 ? (
          <div className="px-3 py-6 text-sm text-gray-500 text-center">
            Add accessory categories under Configuration → Categories first.
          </div>
        ) : (
          <table className="table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">
                  <TableHeaderLabel>Category</TableHeaderLabel>
                </th>
                <th className="text-left">
                  <TableHeaderLabel>Prefix</TableHeaderLabel>
                </th>
                <th className="text-left w-36">
                  <TableHeaderLabel>Preview</TableHeaderLabel>
                </th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => {
                const prefix = byCategory[cat.id] ?? '';
                return (
                  <tr key={cat.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 text-gray-800">{cat.label}</td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={prefix}
                        onChange={(e) => setCategoryPrefix(cat.id, e.target.value)}
                        placeholder={defaultPrefix ? `Uses default (${defaultPrefix})` : 'e.g. MOJDI-'}
                        className="input w-full max-w-xs font-mono text-sm"
                        maxLength={PREFIX_MAX}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">
                      {previewForPrefix(prefix)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-5 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
        <strong className="text-gray-800">Tip:</strong> Barcodes are generated from the accessory
        code (CODE128) — not stored separately. Print labels from the accessory list or form.
      </div>
    </Section>
  );
};

export default AccessoryCodeEditor;
