import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDateTime } from '@wrs/shared';
import { Pencil } from 'lucide-react';
import PropTypes from 'prop-types';

import Modal from '../../components/ui/Modal.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import { salesApi } from '../../lib/api/sales.js';

function formatPaymentDate(value, fallback) {
  return formatDateTime(value || fallback) || '—';
}

function formatPaymentDescription(saleNumber) {
  const billNo = String(saleNumber || '').trim();
  return billNo ? `${billNo} - PAYMENT (SALE)` : 'PAYMENT (SALE)';
}

const SaleTransactionsModal = ({ isOpen, saleId, onClose, onAddPayment }) => {
  const saleQuery = useQuery({
    queryKey: ['sale', saleId, 'transactions-modal'],
    queryFn: () => salesApi.get(saleId),
    enabled: Boolean(isOpen && saleId),
  });

  const sale = saleQuery.data?.data;
  const payments = Array.isArray(sale?.payments) ? sale.payments : [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={sale ? `Transactions - Bill No: ${sale.sale_number}` : 'Transactions'}
    >
      {saleQuery.isLoading ? (
        <div className="py-4 text-sm text-gray-500">Loading transactions…</div>
      ) : saleQuery.isError || !sale ? (
        <div className="py-4 text-sm text-red-600">Could not load transactions.</div>
      ) : payments.length === 0 ? (
        <div className="py-4 text-sm text-gray-500">No transactions for this sale.</div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="table w-full text-xs">
            <thead>
              <tr>
                <th className="text-left">
                  <TableHeaderLabel>Date & Time</TableHeaderLabel>
                </th>
                <th className="text-right">
                  <TableHeaderLabel align="right">Bill Amt.</TableHeaderLabel>
                </th>
                <th className="text-left">
                  <TableHeaderLabel>Payment</TableHeaderLabel>
                </th>
                <th className="text-left">
                  <TableHeaderLabel>Description</TableHeaderLabel>
                </th>
                <th className="text-center w-14">
                  <TableHeaderLabel align="center" nowrap>
                    Action
                  </TableHeaderLabel>
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2 text-gray-700">
                    {formatPaymentDate(payment.created_at, payment.payment_date)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-green-600 tabular-nums">
                    {formatCurrency(Number(payment.amount || 0))}
                  </td>
                  <td className="px-3 py-2 text-gray-700 uppercase">
                    {payment.payment_account_name || '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {formatPaymentDescription(sale.sale_number)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {sale.status !== 'cancelled' && onAddPayment ? (
                      <button
                        type="button"
                        title="Receive payment"
                        className="inline-flex items-center justify-center p-1 rounded hover:bg-green-50 text-green-600"
                        onClick={() => onAddPayment(sale.id)}
                      >
                        <Pencil size={14} />
                      </button>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
};

SaleTransactionsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  saleId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onAddPayment: PropTypes.func,
};

SaleTransactionsModal.defaultProps = {
  saleId: null,
  onAddPayment: undefined,
};

export default SaleTransactionsModal;
