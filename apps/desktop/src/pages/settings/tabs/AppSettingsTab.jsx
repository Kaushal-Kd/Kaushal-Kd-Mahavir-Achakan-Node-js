import { APP_SETTING_GROUPS, APP_SETTING_TYPES } from '@wrs/shared/constants';
import PropTypes from 'prop-types';
import {
  formatInvoiceMargin,
  formatPipeNumbers,
  formatYesNo,
  parseInvoiceMargin,
  parsePipeNumbers,
  parseYesNo,
} from '@wrs/shared/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import Button from '../../../components/ui/Button.jsx';
import DataTable from '../../../components/ui/DataTable.jsx';
import Input from '../../../components/ui/Input.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import Select from '../../../components/ui/Select.jsx';
import TableColumnPicker from '../../../components/ui/TableColumnPicker.jsx';
import Toggle from '../../../components/ui/Toggle.jsx';
import { useDataTableColumns } from '../../../hooks/useDataTableColumns.js';
import { configurationsApi } from '../../../lib/api/configurations.js';
import { invalidateAppSettingConsumers } from '../../../lib/queryInvalidation.js';
import { toast } from '../../../stores/uiStore.js';

import Tab from './_Tab.jsx';

const SETTING_GROUP_ORDER = [
  'availability',
  'booking',
  'dashboard',
  'billing',
  'inventory',
  'orders',
  'whatsapp',
];

function stripHtmlPreview(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncatePreview(value, max = 80) {
  const s = stripHtmlPreview(value);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

const BillNotesHtmlEditor = ({ value, onChange }) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[280px]">
    <div className="flex flex-col gap-1 min-h-0">
      <label htmlFor="bill-notes-html-source" className="text-sm font-medium text-gray-700">
        HTML source
      </label>
      <textarea
        id="bill-notes-html-source"
        className="flex-1 min-h-[240px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono text-gray-800 focus:border-brand focus:ring-1 focus:ring-brand"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      <p className="text-xs text-gray-500">
        Use HTML for formatting (e.g. &lt;br&gt; for line breaks, &lt;ul&gt;&lt;li&gt; for bullets).
        This text appears at the end of every printed invoice.
      </p>
    </div>
    <div className="flex flex-col gap-1 min-h-0">
      <div className="text-sm font-medium text-gray-700">Print preview</div>
      <div className="flex-1 min-h-[240px] overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3">
        {value.trim() ? (
          <div
            className="bill-notes-body text-sm text-gray-800 leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1"
            dangerouslySetInnerHTML={{ __html: value }}
          />
        ) : (
          <p className="text-sm text-gray-400">Nothing to preview yet.</p>
        )}
      </div>
    </div>
  </div>
);

BillNotesHtmlEditor.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
};

/** Compact default: name and value; hide technical key column. */
const APP_SETTINGS_DEFAULT_HIDDEN = ['key'];

function AppSettingsTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editRow, setEditRow] = useState(null);
  const [draftValue, setDraftValue] = useState('');
  const [marginDraft, setMarginDraft] = useState({
    TopMargin: '0',
    BottomMargin: '0',
    LeftMargin: '0',
    RightMargin: '0',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['app-settings', 'tab'],
    queryFn: () => configurationsApi.getAppSettings(),
  });

  const items = data?.data?.items || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        row.key.toLowerCase().includes(q) ||
        stripHtmlPreview(row.value).toLowerCase().includes(q)
    );
  }, [items, search]);

  const groupedSections = useMemo(() => {
    if (search.trim()) return null;
    const byGroup = {};
    for (const row of items) {
      const group = row.group || 'other';
      if (!byGroup[group]) byGroup[group] = [];
      byGroup[group].push(row);
    }
    return SETTING_GROUP_ORDER.filter((g) => byGroup[g]?.length).map((g) => ({
      id: g,
      label: APP_SETTING_GROUPS[g] || g,
      rows: byGroup[g],
    }));
  }, [items, search]);

  const saveMutation = useMutation({
    mutationFn: ({ key, value }) => configurationsApi.updateAppSetting(key, value),
    onSuccess: (_data, variables) => {
      void invalidateAppSettingConsumers(queryClient, variables?.key || '');
      toast.success('Setting saved');
      setEditRow(null);
    },
    onError: (err) => {
      toast.error(err?.message || 'Failed to save setting');
    },
  });

  const openEdit = (row) => {
    setEditRow(row);
    if (row.type === APP_SETTING_TYPES.JSON_MARGIN) {
      setMarginDraft(parseInvoiceMargin(row.value, row.value));
      setDraftValue('');
    } else if (row.type === APP_SETTING_TYPES.YES_NO) {
      setDraftValue(formatYesNo(parseYesNo(row.value, row.value)));
    } else {
      setDraftValue(String(row.value ?? ''));
    }
  };

  const handleSave = () => {
    if (!editRow) return;
    let value = draftValue;
    if (editRow.type === APP_SETTING_TYPES.JSON_MARGIN) {
      value = formatInvoiceMargin(marginDraft);
    } else if (editRow.type === APP_SETTING_TYPES.YES_NO) {
      value = formatYesNo(parseYesNo(draftValue, 'No'));
    } else if (editRow.type === APP_SETTING_TYPES.PIPE_NUMBERS) {
      value = formatPipeNumbers(parsePipeNumbers(draftValue, draftValue));
    }
    saveMutation.mutate({ key: editRow.key, value });
  };

  const allColumns = useMemo(
    () => [
      {
        key: 'action',
        header: 'Action',
        columnPickerLabel: 'Action',
        locked: true,
        align: 'center',
        render: (r) => (
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-brand/30 bg-brand-light/40 p-1.5 text-brand hover:bg-brand-light"
            title="Edit"
            aria-label={`Edit ${r.name}`}
            onClick={() => openEdit(r)}
          >
            <Pencil size={14} />
          </button>
        ),
      },
      {
        key: 'name',
        header: 'Name',
        columnPickerLabel: 'Name',
        render: (r) => <span className="text-sm text-gray-900">{r.name}</span>,
      },
      {
        key: 'key',
        header: 'Key',
        columnPickerLabel: 'Key',
        render: (r) => (
          <span className="text-xs font-mono text-gray-600 break-all">{r.key}</span>
        ),
      },
      {
        key: 'value',
        header: 'Value',
        columnPickerLabel: 'Value',
        render: (r) => (
          <span className="text-sm text-gray-700 break-all" title={stripHtmlPreview(r.value)}>
            {truncatePreview(r.value)}
          </span>
        ),
      },
    ],
    []
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('settings-app-settings', allColumns, {
    defaultHidden: APP_SETTINGS_DEFAULT_HIDDEN,
  });

  const tableScrollClass =
    'min-h-[120px] max-h-[calc(100vh-280px)] lg:max-h-[calc(100vh-240px)]';

  const renderEditor = () => {
    if (!editRow) return null;
    const { type, options = [] } = editRow;

    if (type === APP_SETTING_TYPES.YES_NO) {
      return (
        <div className="flex items-center gap-3">
          <Toggle
            checked={parseYesNo(draftValue, 'No')}
            onChange={(v) => setDraftValue(formatYesNo(v))}
            label={parseYesNo(draftValue, 'No') ? 'Yes' : 'No'}
          />
        </div>
      );
    }

    if (type === APP_SETTING_TYPES.NUMBER) {
      return (
        <Input
          label="Value"
          type="number"
          min={0}
          max={9999}
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
        />
      );
    }

    if (type === APP_SETTING_TYPES.TIME) {
      return (
        <Input
          label="Time"
          type="time"
          step={60}
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
        />
      );
    }

    if (type === APP_SETTING_TYPES.SELECT) {
      return (
        <Select
          label="Value"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          options={options.map((o) => ({ value: o.value, label: o.label }))}
        />
      );
    }

    if (type === APP_SETTING_TYPES.PIPE_NUMBERS) {
      return (
        <div className="space-y-1">
          <Input
            label="Value"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            placeholder="e.g. 0|0 or 17|14|10|8|4"
          />
          <p className="text-xs text-gray-500">Pipe-separated numbers (e.g. CGST|SGST).</p>
        </div>
      );
    }

    if (type === APP_SETTING_TYPES.JSON_MARGIN) {
      return (
        <div className="grid grid-cols-2 gap-3">
          {['TopMargin', 'BottomMargin', 'LeftMargin', 'RightMargin'].map((k) => (
            <Input
              key={k}
              label={k.replace('Margin', ' margin (mm)')}
              type="number"
              min={0}
              value={marginDraft[k]}
              onChange={(e) => setMarginDraft((prev) => ({ ...prev, [k]: e.target.value }))}
            />
          ))}
        </div>
      );
    }

    if (type === APP_SETTING_TYPES.HTML) {
      if (editRow.key === 'BILL_NOTES') {
        return <BillNotesHtmlEditor value={draftValue} onChange={setDraftValue} />;
      }
      return (
        <div className="space-y-1">
          <label htmlFor="app-setting-html-value" className="block text-sm font-medium text-gray-700">
            Value
          </label>
          <textarea
            id="app-setting-html-value"
            className="w-full min-h-[160px] rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:ring-1 focus:ring-brand"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
          />
          <p className="text-xs text-gray-500">HTML allowed (e.g. &lt;br&gt; for line breaks).</p>
        </div>
      );
    }

    return (
      <Input
        label="Value"
        value={draftValue}
        onChange={(e) => setDraftValue(e.target.value)}
      />
    );
  };

  return (
    <Tab
      title="Settings"
      description="Only settings that affect live features are listed. Invoice layout is configured under Bill Templates."
      contentClassName="flex min-h-0 flex-1 flex-col"
      actions={
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search
              size={16}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand focus:ring-1 focus:ring-brand"
            />
          </div>
          <TableColumnPicker {...pickerProps} />
        </div>
      }
    >
      {groupedSections ? (
        <div className="space-y-6 min-h-0 flex-1 overflow-y-auto">
          {groupedSections.map((section) => (
            <section key={section.id}>
              <h3 className="mb-2 text-sm font-semibold text-gray-800">{section.label}</h3>
              <DataTable
                columns={visibleColumns}
                rows={section.rows}
                loading={isLoading}
                emptyMessage="No settings in this group."
                rowKey="key"
                scrollClassName={tableScrollClass}
                visibleCount={section.rows.length}
                totalCount={section.rows.length}
                countLabel="settings"
              />
            </section>
          ))}
        </div>
      ) : (
        <DataTable
          columns={visibleColumns}
          rows={filtered}
          loading={isLoading}
          emptyMessage="No settings match your search."
          rowKey="key"
          scrollClassName="min-h-[calc(100vh-220px)] max-h-[calc(100vh-120px)] lg:min-h-[calc(100vh-200px)] lg:max-h-[calc(100vh-100px)]"
          visibleCount={filtered.length}
          totalCount={filtered.length}
          countLabel="settings"
        />
      )}

      <Modal
        isOpen={!!editRow}
        onClose={() => !saveMutation.isPending && setEditRow(null)}
        title={editRow ? `Edit: ${editRow.name}` : 'Edit setting'}
        size={editRow?.key === 'BILL_NOTES' ? 'xl' : 'md'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditRow(null)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} loading={saveMutation.isPending}>
              Save
            </Button>
          </>
        }
      >
        {editRow ? (
          <div className="space-y-3">
            <p className="text-xs font-mono text-gray-500">{editRow.key}</p>
            {renderEditor()}
          </div>
        ) : null}
      </Modal>
    </Tab>
  );
}

export default AppSettingsTab;
