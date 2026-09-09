import { formatCurrency } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useState } from 'react';

import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { runTablePdfExport, withExportPdfBusy } from '../../lib/reportPdfExport.js';

const FIELDS = [
  ['opening_held', 'Opening held'],
  ['collected', 'Collected'],
  ['retained', 'Retained'],
  ['refunded', 'Refunded'],
  ['released', 'Released'],
  ['recognized', 'Income recognized'],
  ['closing_held', 'Closing held'],
];
const COLUMNS = [
  {
    key: 'account_name',
    header: 'Original funding source',
    render: (row) => `${row.account_name} (${row.account_family})`,
  },
  ...FIELDS.map(([key, header]) => ({
    key,
    header,
    align: 'right',
    render: (row) => formatCurrency(row[key]),
  })),
];

export default function ConditionDepositReconciliation({ data, from, to }) {
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  if (!data) return null;
  const rows = data.rows || [];
  const exportPdf = () =>
    withExportPdfBusy(setBusy, () =>
      runTablePdfExport({
        filename: `condition-deposits_${from}_${to}.pdf`,
        title: 'Condition Deposits Held',
        subtitle: `${from} to ${to} · Supplemental liability reconciliation; not included in trial-balance totals`,
        columns: [
          { key: 'account_name', header: 'Original source' },
          ...FIELDS.map(([key, header]) => ({
            key,
            header,
            get: (row) => formatCurrency(row[key]),
          })),
        ],
        rows,
      })
    );
  return (
    <section className="mt-4 rounded border border-gray-200 bg-white p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Condition Deposits Held</h2>
          <p className="text-xs text-gray-600">
            Supplemental liability reconciliation. Not included in the trial-balance totals above.
            Legacy unverified charges are excluded.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={exportPdf}
          loading={busy}
          disabled={!rows.length}
        >
          Download reconciliation
        </Button>
      </div>
      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowKey="id"
        onRowClick={setSelected}
        emptyTitle="No verified condition-money movements"
        emptyMessage="Held funds appear here after an explicit collection or retention."
      />
      <p className="mt-2 text-sm font-medium">
        Closing held: {formatCurrency(data.summary?.closing_held || 0)}
      </p>
      {selected && (
        <Modal
          isOpen
          onClose={() => setSelected(null)}
          title={`Condition funds · ${selected.account_name}`}
          size="lg"
        >
          <DataTable
            rows={selected.operations || []}
            columns={[
              {
                key: 'payment_date',
                header: 'Date',
                render: (row) => String(row.payment_date).slice(0, 10),
              },
              { key: 'kind', header: 'Operation' },
              { key: 'amount', header: 'Amount', render: (row) => formatCurrency(row.amount) },
              {
                key: 'order_id',
                header: 'Booking',
                render: (row) => (
                  <BookingBillLink orderId={row.order_id}>Open bill</BookingBillLink>
                ),
              },
              { key: 'remarks', header: 'Remarks' },
            ]}
            emptyTitle="No movements within this range"
            emptyMessage="The held balance was brought forward from an earlier period."
          />
        </Modal>
      )}
    </section>
  );
}

ConditionDepositReconciliation.propTypes = {
  data: PropTypes.object,
  from: PropTypes.string.isRequired,
  to: PropTypes.string.isRequired,
};
