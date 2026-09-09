import { formatDateTime, messageIncludesBillPdfToken } from '@wrs/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, RefreshCw } from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useEffect, useState } from 'react';

import Button from '../../../components/ui/Button.jsx';
import TableHeaderLabel from '../../../components/ui/TableHeaderLabel.jsx';
import DataTable from '../../../components/ui/DataTable.jsx';
import Input from '../../../components/ui/Input.jsx';
import Select from '../../../components/ui/Select.jsx';
import TableColumnPicker from '../../../components/ui/TableColumnPicker.jsx';
import Toggle from '../../../components/ui/Toggle.jsx';
import { useDataTableColumns } from '../../../hooks/useDataTableColumns.js';
import { configurationsApi } from '../../../lib/api/configurations.js';
import { whatsappApi } from '../../../lib/api/whatsapp.js';
import { toast } from '../../../stores/uiStore.js';

import Tab, { Section } from './_Tab.jsx';
import WhatsAppConnectionPanel from './WhatsAppConnectionPanel.jsx';

const LOG_TABLE_SCROLL = 'max-h-[220px] min-h-[200px]';
const LOG_BOX_CLASS = 'card flex flex-col min-h-[300px] overflow-hidden';

const ActivityLogBox = ({ title, description, headerActions, children }) => (
  <div className={LOG_BOX_CLASS}>
    <div className="shrink-0 border-b border-gray-100 px-4 py-3 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {description ? <p className="text-xs text-gray-500 mt-0.5">{description}</p> : null}
      </div>
      {headerActions ? <div className="shrink-0">{headerActions}</div> : null}
    </div>
    <div className="flex-1 min-h-0">{children}</div>
  </div>
);

ActivityLogBox.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  headerActions: PropTypes.node,
  children: PropTypes.node,
};

function templatesToDraft(templates) {
  return (templates || []).map((t) => ({
    key: t.key,
    name: t.name,
    is_active: !!t.is_active,
    message: String(t.message ?? ''),
    attach_bill_pdf: !!t.attach_bill_pdf,
  }));
}

function templateWantsBillPdf(row) {
  return !!row?.attach_bill_pdf || messageIncludesBillPdfToken(row?.message);
}

function formatLogTime(iso) {
  if (!iso) return '—';
  return formatDateTime(iso) || String(iso);
}

function copyToken(token) {
  const text = String(token);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast.success('Copied to clipboard'),
      () => toast.error('Could not copy')
    );
    return;
  }
  toast.error('Clipboard not available');
}

const VariableChip = ({ token }) => (
  <button
    type="button"
    onClick={() => copyToken(token)}
    className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-mono text-gray-800 hover:border-brand hover:bg-brand-light/30"
    title="Click to copy"
  >
    <span>{token}</span>
    <Copy size={12} className="shrink-0 text-gray-500" aria-hidden />
  </button>
);

VariableChip.propTypes = {
  token: PropTypes.string.isRequired,
};

const connectionLogColumns = [
  { key: 'created_at', header: 'Time', columnPickerLabel: 'Time', render: (row) => formatLogTime(row.created_at) },
  { key: 'event', header: 'Event', columnPickerLabel: 'Event' },
  { key: 'user_name', header: 'User', columnPickerLabel: 'User', render: (row) => row.user_name || '—' },
  { key: 'message', header: 'Message', columnPickerLabel: 'Message', render: (row) => row.message || '—' },
];

const messageLogColumns = [
  { key: 'created_at', header: 'Time', columnPickerLabel: 'Time', render: (row) => formatLogTime(row.created_at) },
  { key: 'template_key', header: 'Template', columnPickerLabel: 'Template' },
  { key: 'recipient_phone', header: 'Recipient', columnPickerLabel: 'Recipient' },
  {
    key: 'status',
    header: 'Status',
    columnPickerLabel: 'Status',
    render: (row) => (
      <span
        className={
          row.status === 'sent'
            ? 'text-green-700'
            : row.status === 'failed'
              ? 'text-red-600'
              : 'text-gray-600'
        }
      >
        {row.status === 'uncertain' ? 'Needs review — acknowledgment unknown' : row.status}
      </span>
    ),
  },
  { key: 'user_name', header: 'User', columnPickerLabel: 'User', render: (row) => row.user_name || '—' },
];

const reminderColumns = [
  { key: 'order_number', header: 'Bill', columnPickerLabel: 'Bill' },
  { key: 'delivery_date', header: 'Delivery', columnPickerLabel: 'Delivery' },
  { key: 'scheduled_for', header: 'Scheduled', columnPickerLabel: 'Scheduled', render: (row) => formatLogTime(row.scheduled_for) },
  { key: 'status', header: 'Status', columnPickerLabel: 'Status', render: (row) => row.status === 'uncertain' ? 'Needs review — acknowledgment unknown' : row.status },
  { key: 'attempt_count', header: 'Attempts', columnPickerLabel: 'Attempts' },
  { key: 'last_error', header: 'Error', columnPickerLabel: 'Error', render: (row) => row.last_error || '—' },
];

/** Compact defaults for activity log tables. */
const WHATSAPP_CONN_LOG_DEFAULT_HIDDEN = ['user_name', 'message'];
const WHATSAPP_MSG_LOG_DEFAULT_HIDDEN = ['user_name'];

const WhatsAppSettingsTab = () => {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState([]);
  const [savedSnapshot, setSavedSnapshot] = useState([]);
  const [testPhone, setTestPhone] = useState('');
  const [testTemplateKey, setTestTemplateKey] = useState('CREATE_BOOKING');

  const { data, isLoading } = useQuery({
    queryKey: ['whatsapp-messages'],
    queryFn: () => configurationsApi.getWhatsAppMessages(),
  });

  const { data: connData } = useQuery({
    queryKey: ['whatsapp-connection'],
    queryFn: () => whatsappApi.getConnection(),
  });

  const { data: connLogs, isLoading: connLogsLoading } = useQuery({
    queryKey: ['whatsapp-connection-logs'],
    queryFn: () => whatsappApi.listConnectionLogs({ per_page: 20 }),
  });

  const { data: msgLogs, isLoading: msgLogsLoading } = useQuery({
    queryKey: ['whatsapp-message-logs'],
    queryFn: () => whatsappApi.listMessageLogs({ per_page: 20 }),
  });

  const { data: reminderData, isLoading: reminderLoading } = useQuery({
    queryKey: ['whatsapp-reminders'],
    queryFn: () => whatsappApi.listReminders({ status: 'all', per_page: 20 }),
  });

  const runReminderMutation = useMutation({
    mutationFn: () => whatsappApi.runReminders(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-reminders'] });
      toast.success('Delivery reminder check completed');
    },
    onError: (error) => toast.error(error?.response?.data?.error?.message || 'Reminder check failed'),
  });

  const variables = data?.data?.variables || [];
  const canSend = !!connData?.data?.can_send;

  useEffect(() => {
    if (!data?.data?.templates) return;
    const next = templatesToDraft(data.data.templates);
    setDraft(next);
    setSavedSnapshot(next);
    if (next.length && !next.find((t) => t.key === testTemplateKey)) {
      setTestTemplateKey(next[0].key);
    }
  }, [data, testTemplateKey]);

  const saveMutation = useMutation({
    mutationFn: (payload) => configurationsApi.updateWhatsAppMessages(payload),
    onSuccess: (resp) => {
      const next = templatesToDraft(resp?.data?.templates || []);
      setDraft(next);
      setSavedSnapshot(next);
      queryClient.invalidateQueries({ queryKey: ['whatsapp-messages'] });
      toast.success('WhatsApp settings saved');
    },
    onError: (err) => {
      toast.error(err?.message || 'Failed to save WhatsApp settings');
    },
  });

  const testSendMutation = useMutation({
    mutationFn: () => {
      const tpl = draft.find((t) => t.key === testTemplateKey);
      if (templateWantsBillPdf(tpl)) {
        toast.warning(
          'Test send is text only. Bill PDF attachment requires a real booking (e.g. create booking).'
        );
      }
      return whatsappApi.sendMessage({
        template_key: testTemplateKey,
        phone: testPhone,
        context: {
          customer_name: 'Test Customer',
          shop_name: 'Test Shop',
          bill_no: 'TEST-001',
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-message-logs'] });
      toast.success('Test message sent');
    },
    onError: (err) => toast.error(err?.message || 'Send failed'),
  });

  const updateRow = useCallback((key, patch) => {
    setDraft((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  const handleCancel = () => {
    setDraft(savedSnapshot.map((r) => ({ ...r })));
    toast.info('Changes discarded');
  };

  const handleSubmit = () => {
    saveMutation.mutate({
      templates: draft.map((r) => ({
        key: r.key,
        is_active: r.is_active,
        message: r.message,
        attach_bill_pdf: r.attach_bill_pdf,
      })),
    });
  };

  const isDirty = JSON.stringify(draft) !== JSON.stringify(savedSnapshot);

  const templateOptions = draft.map((t) => ({ value: t.key, label: t.name || t.key }));

  const { visibleColumns: connVisibleColumns, pickerProps: connPickerProps } = useDataTableColumns(
    'settings-whatsapp-connection-logs',
    connectionLogColumns,
    { defaultHidden: WHATSAPP_CONN_LOG_DEFAULT_HIDDEN }
  );

  const { visibleColumns: msgVisibleColumns, pickerProps: msgPickerProps } = useDataTableColumns(
    'settings-whatsapp-message-logs',
    messageLogColumns,
    { defaultHidden: WHATSAPP_MSG_LOG_DEFAULT_HIDDEN }
  );

  return (
    <Tab
      title="WhatsApp Setting"
      description="Connect WhatsApp, view activity logs, and manage message templates. Auto-send is configured under App Settings."
      contentClassName="flex min-h-0 flex-1 flex-col gap-6 overflow-auto"
    >
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">WhatsApp Connection</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
          <div className="min-h-0 h-full [&>div]:h-full">
            <WhatsAppConnectionPanel />
          </div>
          <Section
            title="Test send"
            description="Send a template to verify the connection. Uses sample variable values."
            className="h-full flex flex-col"
          >
            <div className="flex flex-1 flex-col justify-center gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-full min-w-[8rem] flex-1 sm:max-w-[10rem]">
                  <Input
                    label="Phone"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="10-digit mobile"
                  />
                </div>
                <div className="w-full min-w-[8rem] flex-1 sm:max-w-[12rem]">
                  <Select
                    label="Template"
                    value={testTemplateKey}
                    onChange={(e) => setTestTemplateKey(e.target.value)}
                    options={templateOptions}
                  />
                </div>
                <Button
                  variant="primary"
                  onClick={() => testSendMutation.mutate()}
                  loading={testSendMutation.isPending}
                  disabled={!canSend || !testPhone.trim()}
                >
                  Send test
                </Button>
              </div>
              {!canSend ? (
                <p className="text-xs text-amber-700">Connect WhatsApp before sending.</p>
              ) : null}
            </div>
          </Section>
        </div>
      </section>

      <Section
        title="Message templates"
        description="Click a variable to copy. {BILL_PDF} attaches the invoice PDF (same as Print bill). Use Attach bill PDF or include {BILL_PDF} in the message."
      >
        <div className="flex flex-wrap gap-2 mb-4">
          {variables.map((token) => (
            <VariableChip key={token} token={token} />
          ))}
        </div>

        <div className="table-wrap flex-1 min-h-0 overflow-auto max-h-[calc(100vh-280px)]">
          <table className="table w-full min-w-[760px]">
            <thead>
              <tr>
                <th className="text-left w-[140px]">
                  <TableHeaderLabel>Name</TableHeaderLabel>
                </th>
                <th className="text-left w-[160px]">
                  <TableHeaderLabel>Key</TableHeaderLabel>
                </th>
                <th className="text-center w-[100px]">
                  <TableHeaderLabel align="center">Is Active</TableHeaderLabel>
                </th>
                <th className="text-center w-[120px]">
                  <TableHeaderLabel align="center">Attach bill PDF</TableHeaderLabel>
                </th>
                <th className="text-left">
                  <TableHeaderLabel>Message</TableHeaderLabel>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && draft.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : (
                draft.map((row) => (
                  <tr key={row.key} className="align-top">
                    <td className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap">{row.name}</td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-600 whitespace-nowrap">
                      {row.key}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex justify-center">
                        <Toggle
                          checked={row.is_active}
                          onChange={(v) => updateRow(row.key, { is_active: v })}
                          label={row.is_active ? 'Yes' : 'No'}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex justify-center">
                        <Toggle
                          checked={row.attach_bill_pdf}
                          onChange={(v) => updateRow(row.key, { attach_bill_pdf: v })}
                          label={row.attach_bill_pdf ? 'Yes' : 'No'}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <textarea
                        className="w-full min-h-[88px] rounded-md border border-gray-300 px-2.5 py-2 text-sm font-mono text-gray-800 focus:border-brand focus:ring-1 focus:ring-brand"
                        value={row.message}
                        onChange={(e) => updateRow(row.key, { message: e.target.value })}
                        rows={4}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4">
          <Button variant="ghost" onClick={handleCancel} disabled={saveMutation.isPending || !isDirty}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={saveMutation.isPending}
            disabled={isLoading || draft.length === 0}
          >
            Save templates
          </Button>
        </div>
      </Section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Activity logs</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Recent WhatsApp connection and outbound message events for this shop.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
          <ActivityLogBox
            title="Connection activity"
            description="Pairing, reconnect, and logout"
            headerActions={<TableColumnPicker {...connPickerProps} />}
          >
            <DataTable
              embedded
              columns={connVisibleColumns}
              rows={connLogs?.data || []}
              loading={connLogsLoading}
              rowKey="id"
              emptyTitle="No connection logs"
              emptyMessage="Connection events will appear here."
              scrollClassName={LOG_TABLE_SCROLL}
              visibleCount={connLogs?.data?.length ?? 0}
              totalCount={connLogs?.meta?.total ?? connLogs?.data?.length ?? 0}
              countLabel="entries"
            />
          </ActivityLogBox>
          <ActivityLogBox
            title="Message activity"
            description="Template sends and delivery status"
            headerActions={<TableColumnPicker {...msgPickerProps} />}
          >
            <DataTable
              embedded
              columns={msgVisibleColumns}
              rows={msgLogs?.data || []}
              loading={msgLogsLoading}
              rowKey="id"
              emptyTitle="No message logs"
              emptyMessage="Sent messages will appear here."
              scrollClassName={LOG_TABLE_SCROLL}
              visibleCount={msgLogs?.data?.length ?? 0}
              totalCount={msgLogs?.meta?.total ?? msgLogs?.data?.length ?? 0}
              countLabel="entries"
            />
          </ActivityLogBox>
        </div>
        <ActivityLogBox
          title="Automatic delivery reminders"
          description="Durable one-day-before-delivery jobs, including failed messages requiring attention"
          headerActions={
            <Button
              size="sm"
              variant="secondary"
              icon={RefreshCw}
              loading={runReminderMutation.isPending}
              onClick={() => runReminderMutation.mutate()}
            >
              Check now
            </Button>
          }
        >
          <DataTable
            embedded
            columns={reminderColumns}
            rows={reminderData?.data?.rows || []}
            loading={reminderLoading}
            rowKey="id"
            emptyTitle="No scheduled reminders"
            emptyMessage="Eligible prepared bookings will appear here one day before delivery."
            scrollClassName={LOG_TABLE_SCROLL}
            visibleCount={reminderData?.data?.rows?.length ?? 0}
            totalCount={reminderData?.data?.meta?.total ?? 0}
            countLabel="reminders"
          />
        </ActivityLogBox>
      </section>
    </Tab>
  );
};

export default WhatsAppSettingsTab;
