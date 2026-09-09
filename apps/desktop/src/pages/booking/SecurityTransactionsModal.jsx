import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDateTime } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useMemo } from 'react';

import Modal from '../../components/ui/Modal.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import { ordersApi } from '../../lib/api/orders.js';

const SECURITY_CATEGORIES = new Set(['deposit', 'deposit_refund']);

function securityLedgerLabel(p) {
  const pay = String(p?.payment_account_name || '').trim();
  const sec = String(p?.security_account_name || '').trim();
  if (pay) return pay;
  if (sec) return sec;
  const pt = String(p?.payment_type || '').trim();
  return pt ? pt.charAt(0).toUpperCase() + pt.slice(1).toLowerCase() : '—';
}

function fmtDateTime(row) {
  return formatDateTime(row?.created_at || row?.createdAt || row?.payment_date) || '—';
}

const SecurityTransactionsModal = ({ isOpen, orderId, onClose, titlePrefix }) => {
  const orderQuery = useQuery({
    queryKey: ['order', orderId, 'security-transactions'],
    queryFn: () => ordersApi.get(orderId).then((r) => r.data),
    enabled: Boolean(isOpen && orderId),
  });

  const order = orderQuery.data;
  const rows = useMemo(() => {
    const payments = Array.isArray(order?.payments) ? order.payments : [];
    return payments
      .filter((p) => SECURITY_CATEGORIES.has(p.category) && !p.is_deleted)
      .slice()
      .sort((a, b) => String(b.created_at || b.payment_date || '').localeCompare(String(a.created_at || a.payment_date || '')));
  }, [order?.payments]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={order ? `${titlePrefix} · Bill No: ${order.order_number}` : titlePrefix}
    >
      {orderQuery.isLoading ? (
        <div className="text-[11px] text-gray-500 py-4">Loading…</div>
      ) : orderQuery.isError || !order ? (
        <div className="text-[11px] text-red-600 py-4">Could not load security transactions.</div>
      ) : rows.length === 0 ? (
        <div className="text-[11px] text-gray-500 py-4">No security transactions yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table text-xs">
            <thead>
              <tr>
                <th>
                  <TableHeaderLabel>Date & Time</TableHeaderLabel>
                </th>
                <th className="text-right">
                  <TableHeaderLabel align="right">Amount</TableHeaderLabel>
                </th>
                <th>
                  <TableHeaderLabel>Account</TableHeaderLabel>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(p)}</td>
                  <td className="text-right font-medium tabular-nums">
                    {p.category === 'deposit_refund' ? '-' : ''}
                    {formatCurrency(Number(p.amount || 0))}
                  </td>
                  <td className="text-gray-800">{securityLedgerLabel(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
};

SecurityTransactionsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  orderId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  titlePrefix: PropTypes.string,
};

SecurityTransactionsModal.defaultProps = {
  orderId: null,
  titlePrefix: 'Security Transactions',
};

export default SecurityTransactionsModal;

