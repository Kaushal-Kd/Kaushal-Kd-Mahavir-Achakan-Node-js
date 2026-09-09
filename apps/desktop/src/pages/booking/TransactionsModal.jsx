import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatPaymentDateTime } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useMemo } from 'react';

import Modal from '../../components/ui/Modal.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import { ordersApi } from '../../lib/api/orders.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { securityAccountsApi } from '../../lib/api/securityAccounts.js';

const CATEGORY_LABEL = {
  advance: 'Advance',
  partial: 'Partial',
  final: 'Final',
  refund: 'Refund',
  deposit: 'Security deposit',
  deposit_refund: 'Deposit refund',
};

const DEPOSIT_CATEGORIES = new Set(['deposit', 'deposit_refund']);

function ledgerName(id, map) {
  if (!id) return '—';
  return map.get(id) || id;
}

function formatTxnDateTime(row) {
  return formatPaymentDateTime(row) || '—';
}

function paymentSortKey(row) {
  const date = String(row.payment_date || '').slice(0, 10);
  const created = String(row.created_at || '');
  return `${date}\0${created}`;
}

function sortPaymentsNewestFirst(rows) {
  return rows.slice().sort((a, b) => paymentSortKey(b).localeCompare(paymentSortKey(a)));
}

function TransactionLogTable({ rows, variant, paymentAccountMap, securityAccountMap }) {
  if (!rows.length) {
    return (
      <p className="text-sm text-gray-500 py-3">
        {variant === 'deposit' ? 'No security deposit transactions yet.' : 'No payment transactions yet.'}
      </p>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table text-xs">
        <thead>
          <tr>
            <th>
              <TableHeaderLabel>Date & Time</TableHeaderLabel>
            </th>
            <th>
              <TableHeaderLabel>Category</TableHeaderLabel>
            </th>
            <th>
              <TableHeaderLabel>Mode</TableHeaderLabel>
            </th>
            <th className="text-right">
              <TableHeaderLabel align="right">Amount</TableHeaderLabel>
            </th>
            {variant === 'payment' ? (
              <th>
                <TableHeaderLabel>Bill account</TableHeaderLabel>
              </th>
            ) : (
              <th>
                <TableHeaderLabel>Security account</TableHeaderLabel>
              </th>
            )}
            <th>
              <TableHeaderLabel>Txn id</TableHeaderLabel>
            </th>
            <th>
              <TableHeaderLabel>Notes</TableHeaderLabel>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="whitespace-nowrap">{formatTxnDateTime(p)}</td>
              <td>{CATEGORY_LABEL[p.category] || p.category || '—'}</td>
              <td className="capitalize">{p.payment_type || '—'}</td>
              <td className="text-right font-medium tabular-nums">
                {p.category === 'deposit_refund' ? '-' : ''}
                {formatCurrency(Number(p.amount || 0))}
              </td>
              <td>
                {variant === 'payment'
                  ? ledgerName(p.payment_account_id, paymentAccountMap)
                  : ledgerName(p.security_account_id, securityAccountMap)}
              </td>
              <td className="font-mono">{p.transaction_id || '—'}</td>
              <td>{p.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

TransactionLogTable.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  variant: PropTypes.oneOf(['payment', 'deposit']).isRequired,
  paymentAccountMap: PropTypes.instanceOf(Map).isRequired,
  securityAccountMap: PropTypes.instanceOf(Map).isRequired,
};

const TransactionsModal = ({ isOpen, orderId, onClose }) => {
  const orderQuery = useQuery({
    queryKey: ['order', orderId, 'transactions-modal'],
    queryFn: () => ordersApi.get(orderId).then((r) => r.data),
    enabled: Boolean(isOpen && orderId),
  });
  const paymentAccountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
    enabled: Boolean(isOpen),
  });
  const securityAccountsQuery = useQuery({
    queryKey: ['security-accounts', 'transactions-modal'],
    queryFn: () => securityAccountsApi.list(),
    enabled: Boolean(isOpen),
  });

  const paymentAccountMap = useMemo(
    () => new Map((paymentAccountsQuery.data?.data || []).map((a) => [a.id, a.name])),
    [paymentAccountsQuery.data?.data]
  );
  const securityAccountMap = useMemo(
    () => new Map((securityAccountsQuery.data?.data || []).map((a) => [a.id, a.name])),
    [securityAccountsQuery.data?.data]
  );

  const order = orderQuery.data;
  const { paymentRows, depositRows } = useMemo(() => {
    const payments = (Array.isArray(order?.payments) ? order.payments : []).filter((p) => !p.is_deleted);
    const deposit = [];
    const payment = [];
    for (const p of payments) {
      if (DEPOSIT_CATEGORIES.has(p.category)) deposit.push(p);
      else payment.push(p);
    }
    return {
      paymentRows: sortPaymentsNewestFirst(payment),
      depositRows: sortPaymentsNewestFirst(deposit),
    };
  }, [order?.payments]);

  const hasAnyRows = paymentRows.length > 0 || depositRows.length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={order ? `Transactions · ${order.order_number}` : 'Transactions'}
    >
      {orderQuery.isLoading ? (
        <div className="text-sm text-gray-500 py-4">Loading transactions…</div>
      ) : orderQuery.isError || !order ? (
        <div className="text-sm text-red-600 py-4">Could not load transactions.</div>
      ) : !hasAnyRows ? (
        <div className="text-sm text-gray-500 py-4">No transactions for this booking.</div>
      ) : (
        <div className="space-y-6">
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Payment log</h3>
            <TransactionLogTable
              rows={paymentRows}
              variant="payment"
              paymentAccountMap={paymentAccountMap}
              securityAccountMap={securityAccountMap}
            />
          </section>
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Security deposit log</h3>
            <TransactionLogTable
              rows={depositRows}
              variant="deposit"
              paymentAccountMap={paymentAccountMap}
              securityAccountMap={securityAccountMap}
            />
          </section>
        </div>
      )}
    </Modal>
  );
};

TransactionsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  orderId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
};

TransactionsModal.defaultProps = {
  orderId: null,
};

export default TransactionsModal;
