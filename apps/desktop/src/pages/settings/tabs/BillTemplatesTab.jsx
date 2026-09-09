import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { FileText, Plus, Printer, Save, Search, Star, Trash2 } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import AdminDeleteModal from '../../../components/ui/AdminDeleteModal.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import Button from '../../../components/ui/Button.jsx';
import Input from '../../../components/ui/Input.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import Select from '../../../components/ui/Select.jsx';
import Toggle from '../../../components/ui/Toggle.jsx';
import { useAdminDelete } from '../../../hooks/useAdminDelete.js';
import { useSelectedShopName } from '../../../hooks/useSelectedShopName.js';
import { configurationsApi } from '../../../lib/api/configurations.js';
import { billTemplatesApi } from '../../../lib/api/billTemplates.js';
import { getApiErrorMessage } from '../../../lib/apiError.js';
import { useShopStore } from '../../../stores/shopStore.js';
import { toast } from '../../../stores/uiStore.js';
import {
  DEFAULT_TEMPLATE,
  DEFAULT_MANUAL_BILL_CONTENT,
  PAPER_SIZES,
  SAMPLE_ORDER,
  mergeTemplate,
  renderBillHtml,
} from '../../../utils/billTemplates.js';
import { invalidateBillTemplateCache } from '../../../utils/printBill.js';
import { applyShopLogoToTemplate, mapShopForBill } from '../../../utils/shopBillHeader.js';

import Tab, { Section } from './_Tab.jsx';

/* ---------- helpers ---------- */

const blankTemplate = (name = 'New template', paper_size = 'A4') => ({
  name,
  is_default: false,
  ...DEFAULT_TEMPLATE,
  paper_size,
});

/**
 * Editable shape of a template row.
 *
 * Deep-merges against the defaults with the same `mergeTemplate` the renderer
 * uses, so a key missing from stored JSON can't show OFF in the editor while
 * printing as ON. Server-owned columns (id, shop_id, created_at, updated_at)
 * are deliberately excluded: they must not be echoed back on save, and
 * including updated_at would make the dirty check never settle.
 */
const buildDraft = (row) => ({
  name: row?.name || '',
  is_default: !!row?.is_default,
  ...mergeTemplate(row),
});

const PAPER_SHORT = {
  A4: 'A4',
  A5: 'A5',
  thermal_80: '80 mm',
  thermal_58: '58 mm',
};

const paperLabelShort = (id) => PAPER_SHORT[id] || id;

/* ---------- main ---------- */

const BillTemplatesTab = () => {
  const qc = useQueryClient();
  const selectedShopId = useShopStore((s) => s.selectedShopId);
  const shops = useShopStore((s) => s.shops);
  const shop = shops.find((sh) => sh.id === selectedShopId);

  const { data, isLoading } = useQuery({
    queryKey: ['bill-templates'],
    queryFn: () => billTemplatesApi.list(),
  });
  const { data: appSettingsData } = useQuery({
    queryKey: ['app-settings', 'bill-template-preview'],
    queryFn: () => configurationsApi.getAppSettings(),
    staleTime: 60_000,
  });
  const billNotesHtml = useMemo(() => {
    const row = (appSettingsData?.data?.items || []).find((i) => i.key === 'BILL_NOTES');
    return String(row?.value || '');
  }, [appSettingsData]);
  const templates = data?.data || [];

  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(blankTemplate());
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', paper_size: 'A4' });
  const selectedShopName = useSelectedShopName();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bill-templates'] });
    invalidateBillTemplateCache();
  };

  const {
    target: deleting,
    requestDelete,
    confirmDelete,
    error: deleteError,
    clearError: clearDeleteError,
    loading: deleteLoading,
    close: closeDelete,
  } = useAdminDelete({
    deleteFn: (row, admin_password) => billTemplatesApi.remove(row.id, { admin_password }),
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
      toast.success('Template deleted');
    },
  });

  const current = templates.find((t) => t.id === selectedId) || null;

  useEffect(() => {
    if (!selectedId && templates.length) {
      const def = templates.find((t) => t.is_default) || templates[0];
      setSelectedId(def.id);
    }
  }, [templates, selectedId]);

  useEffect(() => {
    if (current) setDraft(buildDraft(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  /* ---------- mutations ---------- */

  const createMut = useMutation({
    mutationFn: (payload) => billTemplatesApi.create(payload),
    onSuccess: (res) => {
      invalidate();
      setSelectedId(res?.data?.id || null);
      setCreating(false);
      setNewForm({ name: '', paper_size: 'A4' });
      toast.success('Template created');
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Could not create template')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }) => billTemplatesApi.update(id, payload),
    onSuccess: (res) => {
      invalidate();
      // Resync from the saved row rather than waiting on the refetch, so the
      // dirty indicator clears immediately and can't race the list query.
      if (res?.data) setDraft(buildDraft(res.data));
      toast.success('Template saved');
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Could not save template')),
  });

  const setDefaultMut = useMutation({
    mutationFn: (id) => billTemplatesApi.setDefault(id),
    onSuccess: () => {
      invalidate();
      // The draft still holds is_default:false from before this call. Without
      // syncing it, the dirty check flips true and the next Save would write
      // that stale false back — leaving the shop with no default template.
      setDraft((d) => ({ ...d, is_default: true }));
      toast.success('Default template updated');
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Could not set default template')),
  });

  /* ---------- derived ---------- */

  const previewHtml = useMemo(() => {
    const shopHeader = mapShopForBill(shop);
    const template = applyShopLogoToTemplate(draft, shopHeader);
    return renderBillHtml({
      order: SAMPLE_ORDER,
      template,
      shop: shopHeader,
      billNotesHtml,
    });
  }, [draft, shop, billNotesHtml]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => (t.name || '').toLowerCase().includes(q));
  }, [templates, query]);

  const baseSize = Number(draft.typography?.base_size) || 12;

  const isDirty = useMemo(() => {
    if (!current) return false;
    try {
      return JSON.stringify(buildDraft(current)) !== JSON.stringify(draft);
    } catch {
      return true;
    }
  }, [current, draft]);

  /* ---------- actions ---------- */

  const updateDraft = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const updateSection = (section, patch) =>
    setDraft((d) => ({ ...d, [section]: { ...(d[section] || {}), ...patch } }));

  const handleSave = () => {
    if (!current) return;
    updateMut.mutate({ id: current.id, payload: draft });
  };

  const handlePrint = () => {
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.open();
    w.document.write(previewHtml);
    w.document.close();
    setTimeout(() => {
      w.focus();
      w.print();
    }, 300);
  };

  const openCreate = () => {
    setNewForm({ name: '', paper_size: 'A4' });
    setCreating(true);
  };

  const tabActions = (
    <>
      <Button variant="secondary" icon={Printer} onClick={handlePrint} disabled={!current}>
        Print preview
      </Button>
      <Button
        icon={Save}
        onClick={handleSave}
        loading={updateMut.isPending}
        disabled={!current || !isDirty}
      >
        Save changes
      </Button>
    </>
  );

  return (
    <Tab
      title="Bill / Invoice Templates"
      description="Design A4, A5 and thermal (58 / 80 mm) bill templates with a live preview."
      actions={tabActions}
    >
      {/* ---------- TOP BAR: Template picker ---------- */}
      <div className="card p-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative w-full lg:w-64 shrink-0">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates…"
              className="input pl-8 h-9"
            />
          </div>

          <div className="flex-1 min-w-0">
            {isLoading ? (
              <div className="text-sm text-gray-400 py-1">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="text-sm text-gray-400 py-1">
                {templates.length === 0
                  ? 'No templates yet. Create your first one.'
                  : 'No templates match your search.'}
              </div>
            ) : (
              <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1">
                {filtered.map((t) => {
                  const active = selectedId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={clsx(
                        'group shrink-0 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition',
                        active
                          ? 'border-brand bg-brand-light/70 text-brand shadow-sm'
                          : 'border-gray-200 bg-surface text-gray-700 hover:border-brand/50 hover:bg-gray-50'
                      )}
                    >
                      <span
                        className={clsx(
                          'rounded p-1',
                          active ? 'bg-brand text-white' : 'bg-gray-100 text-gray-500'
                        )}
                      >
                        <FileText size={11} />
                      </span>
                      <span className="truncate max-w-[160px]">{t.name}</span>
                      <span
                        className={clsx(
                          'rounded-full border px-1.5 py-px text-[10px] font-semibold',
                          active ? 'border-brand/50 text-brand' : 'border-gray-300 text-gray-500'
                        )}
                      >
                        {paperLabelShort(t.paper_size)}
                      </span>
                      {t.is_default ? (
                        <Star size={12} className="text-yellow-500 fill-yellow-400 shrink-0" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <Button variant="primary" size="sm" icon={Plus} onClick={openCreate} className="shrink-0">
            New template
          </Button>
        </div>
      </div>

      {/* ---------- BODY: Editor + Live preview ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-4">
        {/* ----- LEFT: Editor ----- */}
        <div className="space-y-4 min-w-0">
          {!current ? (
            <Section>
              <div className="text-center py-14 px-4">
                <div className="mx-auto w-12 h-12 rounded-full bg-brand-light/70 flex items-center justify-center text-brand mb-3">
                  <FileText size={20} />
                </div>
                <div className="text-sm font-medium text-gray-800">No template selected</div>
                <div className="text-xs text-gray-500 mt-1">
                  Pick a template from the list on the left, or create a new one to get started.
                </div>
                <Button icon={Plus} onClick={openCreate} className="mt-4">
                  New template
                </Button>
              </div>
            </Section>
          ) : (
            <>
              {/* Status strip */}
              <div className="card p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="rounded-md bg-brand-light text-brand p-2 shrink-0">
                    <FileText size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">
                      {current.name}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge tone="brand" className="text-[10px] py-0">
                        {paperLabelShort(draft.paper_size)}
                      </Badge>
                      {current.is_default ? (
                        <Badge tone="yellow" className="text-[10px] py-0">
                          <Star size={10} className="fill-yellow-400 text-yellow-500" /> Default
                        </Badge>
                      ) : null}
                      {isDirty ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Unsaved changes
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-500">All changes saved</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!current.is_default ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Star}
                      onClick={() => setDefaultMut.mutate(current.id)}
                      loading={setDefaultMut.isPending}
                    >
                      Set default
                    </Button>
                  ) : null}
                  <Button
                    variant="danger"
                    size="sm"
                    icon={Trash2}
                    onClick={() => requestDelete(current)}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              {/* Basic info */}
              <Section title="Basic info" description="Name, paper size and default behaviour.">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    label="Template name"
                    value={draft.name || ''}
                    onChange={(e) => updateDraft({ name: e.target.value })}
                    required
                  />
                  <Select
                    label="Paper size"
                    value={draft.paper_size || 'A4'}
                    onChange={(e) => updateDraft({ paper_size: e.target.value })}
                    options={PAPER_SIZES.map((p) => ({ value: p.id, label: p.label }))}
                  />
                </div>
                <div className="mt-4">
                  <Toggle
                    checked={!!draft.is_default}
                    onChange={(v) => updateDraft({ is_default: v })}
                    label="Use as default for this shop"
                    description="New bills will use this template unless overridden at the order level."
                  />
                </div>
              </Section>

              <Section
                title="Blank-paper placement"
                description="Move the complete bill up or down and optionally arrange its printable blocks manually."
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    type="number"
                    min={-2}
                    max={4}
                    step="0.05"
                    label="Vertical placement (inches)"
                    hint="Use a negative value to move up and a positive value to move down."
                    value={draft.page_settings?.vertical_offset_in ?? 0}
                    onChange={(e) =>
                      updateSection('page_settings', {
                        vertical_offset_in:
                          e.target.value === ''
                            ? 0
                            : Math.min(4, Math.max(-2, Number(e.target.value) || 0)),
                      })
                    }
                  />
                  <Toggle
                    label="Manual blank-paper layout"
                    description="Edit the order of printable bill blocks without allowing unsafe scripts."
                    checked={!!draft.custom_content?.enabled}
                    onChange={(v) => updateSection('custom_content', { enabled: v })}
                  />
                </div>
                {draft.custom_content?.enabled ? (
                  <div className="mt-4">
                    <label className="label" htmlFor="manual-bill-content">
                      Manual print layout
                    </label>
                    <textarea
                      id="manual-bill-content"
                      className="input min-h-[180px] font-mono text-xs"
                      value={draft.custom_content?.text || ''}
                      onChange={(e) => updateSection('custom_content', { text: e.target.value })}
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-gray-500">
                        Blocks: {'{{header}}'}, {'{{customer}}'}, {'{{items}}'}, {'{{totals}}'},
                        {' {{footer}}'}, {' {{notes}}'}. Text tokens: {'{{shop_name}}'},
                        {' {{bill_number}}'}, {' {{customer_name}}'}, {' {{pickup_date}}'},
                        {' {{return_date}}'}, {' {{total}}'}.
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          updateSection('custom_content', { text: DEFAULT_MANUAL_BILL_CONTENT })
                        }
                      >
                        Reset layout
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Section>

              {/* Header */}
              <Section title="Header" description="What appears at the top of every bill.">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    label="Header title"
                    placeholder="e.g. Invoice, Rental Contract"
                    value={draft.header_config?.title || ''}
                    onChange={(e) => updateSection('header_config', { title: e.target.value })}
                  />
                  <Input
                    label="Logo URL"
                    placeholder="https://…/logo.png"
                    value={draft.logo_url || ''}
                    onChange={(e) => updateDraft({ logo_url: e.target.value })}
                  />
                </div>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Toggle
                    size="sm"
                    label="Show logo"
                    checked={!!draft.header_config?.show_logo}
                    onChange={(v) => updateSection('header_config', { show_logo: v })}
                  />
                  <Toggle
                    size="sm"
                    label="Show address"
                    checked={!!draft.header_config?.show_address}
                    onChange={(v) => updateSection('header_config', { show_address: v })}
                  />
                  <Toggle
                    size="sm"
                    label="Show phone"
                    checked={!!draft.header_config?.show_phone}
                    onChange={(v) => updateSection('header_config', { show_phone: v })}
                  />
                </div>
              </Section>

              {/* Items table */}
              <Section
                title="Items table"
                description="Control the columns printed on the item list."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Toggle
                    size="sm"
                    label="Item code"
                    checked={!!draft.items_config?.show_code}
                    onChange={(v) => updateSection('items_config', { show_code: v })}
                  />
                  <Toggle
                    size="sm"
                    label="Quantity"
                    checked={!!draft.items_config?.show_qty}
                    onChange={(v) => updateSection('items_config', { show_qty: v })}
                  />
                  <Toggle
                    size="sm"
                    label="Discount"
                    checked={!!draft.items_config?.show_discount}
                    onChange={(v) => updateSection('items_config', { show_discount: v })}
                  />
                  <Toggle
                    size="sm"
                    label="Tax"
                    checked={!!draft.items_config?.show_tax}
                    onChange={(v) => updateSection('items_config', { show_tax: v })}
                  />
                  <Toggle
                    size="sm"
                    label="Include accessories"
                    checked={!!draft.items_config?.show_accessories}
                    onChange={(v) => updateSection('items_config', { show_accessories: v })}
                  />
                </div>
              </Section>

              {/* Footer */}
              <Section title="Footer" description="Thank-you note, terms and signature line.">
                <div className="space-y-3">
                  <Input
                    label="Thank-you note"
                    value={draft.footer_config?.thank_you || ''}
                    onChange={(e) => updateSection('footer_config', { thank_you: e.target.value })}
                  />
                  <div>
                    <label className="label" htmlFor="bill-template-terms">
                      Terms &amp; conditions
                    </label>
                    <textarea
                      id="bill-template-terms"
                      className="input"
                      rows={3}
                      value={draft.footer_config?.terms || ''}
                      onChange={(e) => updateSection('footer_config', { terms: e.target.value })}
                    />
                  </div>
                  <Toggle
                    size="sm"
                    label="Show signature lines"
                    checked={!!draft.footer_config?.show_signature}
                    onChange={(v) => updateSection('footer_config', { show_signature: v })}
                  />
                </div>
              </Section>

              {/* Typography & colors */}
              <Section
                title="Typography & colors"
                description="Fine-tune the look of the printed bill."
              >
                {/* Item-row sizes follow the base font until explicitly overridden. */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Input
                    type="number"
                    min={8}
                    max={18}
                    label="Base font (px)"
                    value={draft.typography?.base_size ?? 12}
                    onChange={(e) =>
                      updateSection('typography', {
                        base_size: e.target.value === '' ? '' : Number(e.target.value) || 12,
                      })
                    }
                  />
                  <Input
                    type="number"
                    min={12}
                    max={28}
                    label="Heading (px)"
                    value={draft.typography?.heading_size ?? 18}
                    onChange={(e) =>
                      updateSection('typography', {
                        heading_size: e.target.value === '' ? '' : Number(e.target.value) || 18,
                      })
                    }
                  />
                  <Input
                    type="number"
                    min={6}
                    max={18}
                    label="Product rows (px)"
                    value={draft.typography?.product_size ?? baseSize}
                    onChange={(e) =>
                      updateSection('typography', {
                        product_size:
                          e.target.value === '' ? null : Number(e.target.value) || baseSize,
                      })
                    }
                  />
                  <Input
                    type="number"
                    min={6}
                    max={18}
                    label="Accessory rows (px)"
                    value={draft.typography?.accessory_size ?? Math.max(6, baseSize - 1)}
                    onChange={(e) =>
                      updateSection('typography', {
                        accessory_size:
                          e.target.value === ''
                            ? null
                            : Number(e.target.value) || Math.max(6, baseSize - 1),
                      })
                    }
                  />
                  <ColorField
                    label="Brand color"
                    value={draft.colors?.brand || '#0C6EE1'}
                    onChange={(v) => updateSection('colors', { brand: v })}
                  />
                  <ColorField
                    label="Border color"
                    value={draft.colors?.border || '#e5e7eb'}
                    onChange={(v) => updateSection('colors', { border: v })}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  Product code prints bold under the product name. Accessory rows use their own size
                  so bills with many add-ons stay readable.
                </p>
              </Section>
            </>
          )}
        </div>

        {/* ----- RIGHT: Live preview ----- */}
        <div className="min-w-0">
          <div className="card p-0 overflow-hidden sticky top-2">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
              <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                Live preview
              </div>
              <Badge tone="brand" className="text-[10px]">
                {paperLabelShort(draft.paper_size)}
              </Badge>
            </div>
            <iframe
              title="bill-preview"
              srcDoc={previewHtml}
              className="w-full h-[720px] bg-white border-0"
            />
            <div className="px-3 py-2 border-t border-gray-200 bg-gray-50 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                icon={Printer}
                onClick={handlePrint}
                disabled={!current}
              >
                Print preview
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Modals ---------- */}
      <Modal
        isOpen={creating}
        onClose={() => setCreating(false)}
        title="New template"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setCreating(false)}
              disabled={createMut.isPending}
            >
              Cancel
            </Button>
            <Button
              icon={Plus}
              onClick={() =>
                createMut.mutate(
                  blankTemplate(newForm.name.trim() || 'New template', newForm.paper_size)
                )
              }
              loading={createMut.isPending}
              disabled={!newForm.name.trim()}
            >
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Template name"
            required
            placeholder="e.g. Wedding — A4 Classic"
            value={newForm.name}
            onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Select
            label="Paper size"
            value={newForm.paper_size}
            onChange={(e) => setNewForm((f) => ({ ...f, paper_size: e.target.value }))}
            options={PAPER_SIZES.map((p) => ({ value: p.id, label: p.label }))}
          />
        </div>
      </Modal>

      <AdminDeleteModal
        isOpen={Boolean(deleting)}
        onClose={closeDelete}
        onConfirm={confirmDelete}
        title="Delete template"
        description="This cannot be undone."
        itemLabel={deleting?.name}
        shopName={selectedShopName}
        errorMessage={deleteError}
        onClearError={clearDeleteError}
        loading={deleteLoading}
      />
    </Tab>
  );
};

/* ---------- small helpers ---------- */

const ColorField = ({ label, value, onChange }) => (
  <div>
    <label className="label" htmlFor={`bill-color-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      {label}
    </label>
    <div className="flex items-center gap-2">
      <input
        id={`bill-color-${label.toLowerCase().replace(/\s+/g, '-')}`}
        type="color"
        className="h-9 w-12 rounded border border-gray-200 p-0.5 cursor-pointer shrink-0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="text-xs text-gray-500 font-mono uppercase">{value}</span>
    </div>
  </div>
);

ColorField.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default BillTemplatesTab;
