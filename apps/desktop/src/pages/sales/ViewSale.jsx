import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatPaymentDateTime, round2 } from '@wrs/shared';
import { ArrowLeft, Download, Pencil, Printer } from 'lucide-react';
import PropTypes from 'prop-types';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import { salesApi } from '../../lib/api/sales.js';
import { formatSaleRecordDateTime } from '../../lib/listTimestampColumns.js';
import { toast } from '../../stores/uiStore.js';
import { downloadSale, printSale } from '../../utils/printBill.js';

const SummaryRow = ({ label, value, strong = false }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-gray-100 py-1.5 last:border-b-0">
    <span className="text-xs text-gray-600">{label}</span>
    <span
      className={`text-right text-sm tabular-nums break-words ${strong ? 'font-bold text-gray-900' : 'font-medium text-gray-900'}`}
    >
      {value}
    </span>
  </div>
);

SummaryRow.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
  strong: PropTypes.bool,
};

const ViewSale = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');

  const saleQuery = useQuery({
    queryKey: ['sale', id],
    queryFn: () => salesApi.get(id),
    enabled: Boolean(id),
  });
  const sale = saleQuery.data?.data;

  const runBill = async (kind) => {
    if (!sale) return;
    setBusy(kind);
    try {
      if (kind === 'print') await printSale(sale);
      else {
        await downloadSale(sale);
        toast.success('Bill downloaded as PDF');
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not prepare bill');
    } finally {
      setBusy('');
    }
  };

  if (saleQuery.isLoading) {
    return <div className="p-6 text-sm text-gray-500">Loading sale…</div>;
  }
  if (!sale) {
    return (
      <div className="p-6 text-sm text-gray-500">
        Sale not found.{' '}
        <button type="button" className="text-brand hover:underline" onClick={() => navigate('/sales')}>
          Back to sales
        </button>
      </div>
    );
  }

  const items = Array.isArray(sale.items) ? sale.items : [];
  const payments = Array.isArray(sale.payments) ? sale.payments : [];
  const hasGst = Number(sale.tax_total || 0) > 0;
  const pending = round2(Math.max(0, Number(sale.total_amount || 0) - Number(sale.advance || 0)));
  const cancelled = String(sale.status || '').toLowerCase() === 'cancelled';

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Dashboard', to: '/' },
          { label: 'Sales', to: '/sales' },
          { label: sale.sale_number || 'Sale' },
        ]}
        title={`Sale · ${sale.sale_number || ''}`}
        description={`${formatSaleRecordDateTime(sale)} · ${sale.customer_name || '—'}`}
        actions={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="secondary" icon={ArrowLeft} onClick={() => navigate(-1)}>
              Back
            </Button>
            {!cancelled ? (
              <Button
                size="sm"
                variant="secondary"
                icon={Pencil}
                onClick={() => navigate(`/sales/${sale.id}/edit`)}
              >
                Edit
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              icon={Download}
              loading={busy === 'download'}
              disabled={Boolean(busy)}
              onClick={() => runBill('download')}
            >
              Download
            </Button>
            <Button
              size="sm"
              icon={Printer}
              loading={busy === 'print'}
              disabled={Boolean(busy)}
              onClick={() => runBill('print')}
            >
              Print bill
            </Button>
          </div>
        }
      />

      <div className="space-y-3 pb-6">
        <section className="card p-3 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <h3 className="text-xs font-semibold text-gray-900 uppercase mb-1">Customer</h3>
            <SummaryRow label="Bill No" value={sale.sale_number || '—'} />
            <SummaryRow label="Name" value={sale.customer_name || '—'} />
            <SummaryRow label="Contact No." value={sale.contact_no || '—'} />
            <SummaryRow label="Address" value={sale.address || '—'} />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-gray-900 uppercase mb-1">Details</h3>
            <SummaryRow label="Date & Time" value={formatSaleRecordDateTime(sale)} />
            <SummaryRow label="Bill Type" value={hasGst || sale.bill_type === 'gst' ? 'GST Bill' : 'Kaccha Bill'} />
            <SummaryRow label="Salesman" value={sale.sales_person_name || '—'} />
            <SummaryRow
              label="Status"
              value={<Badge tone={cancelled ? 'red' : 'green'}>{cancelled ? 'Cancelled' : 'Active'}</Badge>}
            />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-gray-900 uppercase mb-1">Amounts</h3>
            <SummaryRow label="Subtotal" value={formatCurrency(sale.subtotal)} />
            <SummaryRow label="Discount" value={formatCurrency(sale.discount_amount)} />
            {hasGst ? <SummaryRow label="Tax" value={formatCurrency(sale.tax_total)} /> : null}
            <SummaryRow label="Bill Amount" value={formatCurrency(sale.total_amount)} strong />
            <SummaryRow label="Advance / Paid" value={formatCurrency(sale.advance)} />
            <SummaryRow
              label="Pending"
              value={<span className={pending > 0 ? 'text-red-600' : 'text-green-700'}>{formatCurrency(pending)}</span>}
              strong
            />
          </div>
        </section>

        <section className="card p-3">
          <h3 className="text-xs font-semibold text-gray-900 uppercase mb-2">Items</h3>
          <div className="table-wrap">
            <table className="table text-xs">
              <thead>
                <tr>
                  <th>
                    <TableHeaderLabel>Name</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Qty</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Price</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Discount</TableHeaderLabel>
                  </th>
                  {hasGst ? (
                    <th className="text-right">
                      <TableHeaderLabel align="right">Tax</TableHeaderLabel>
                    </th>
                  ) : null}
                  <th className="text-right">
                    <TableHeaderLabel align="right">Total</TableHeaderLabel>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <span className="mr-1 rounded border border-gray-200 px-1 text-[10px] text-gray-500">
                        {it.item_type === 'product' ? 'Product' : 'Accessory'}
                      </span>
                      {it.name_snapshot || '—'}
                    </td>
                    <td className="text-right tabular-nums">{Number(it.qty || 0)}</td>
                    <td className="text-right tabular-nums">{formatCurrency(it.price)}</td>
                    <td className="text-right tabular-nums">{formatCurrency(it.discount)}</td>
                    {hasGst ? (
                      <td className="text-right tabular-nums">
                        {formatCurrency(
                          Number(it.cgst_amount || 0) +
                            Number(it.sgst_amount || 0) +
                            Number(it.igst_amount || 0)
                        )}
                      </td>
                    ) : null}
                    <td className="text-right tabular-nums font-medium">
                      {formatCurrency(it.total_amount)}
                    </td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={hasGst ? 6 : 5} className="text-center text-gray-500 py-4">
                      No items.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {payments.length > 0 ? (
          <section className="card p-3">
            <h3 className="text-xs font-semibold text-gray-900 uppercase mb-2">Payments</h3>
            <div className="table-wrap">
              <table className="table text-xs">
                <thead>
                  <tr>
                    <th>
                      <TableHeaderLabel>Date & Time</TableHeaderLabel>
                    </th>
                    <th>
                      <TableHeaderLabel>Account</TableHeaderLabel>
                    </th>
                    <th>
                      <TableHeaderLabel>Mode</TableHeaderLabel>
                    </th>
                    <th className="text-right">
                      <TableHeaderLabel align="right">Amount</TableHeaderLabel>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="tabular-nums">{formatPaymentDateTime(p) || '—'}</td>
                      <td>{p.payment_account_name || '—'}</td>
                      <td className="capitalize">{p.payment_type || '—'}</td>
                      <td className="text-right tabular-nums">{formatCurrency(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {sale.remark ? (
          <section className="card p-3">
            <h3 className="text-xs font-semibold text-gray-900 uppercase mb-1">Remark</h3>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{sale.remark}</p>
          </section>
        ) : null}
      </div>
    </>
  );
};

export default ViewSale;
