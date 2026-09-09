import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDateTime } from '@wrs/shared';
import { Pencil } from 'lucide-react';
import PropTypes from 'prop-types';

import Modal from '../../components/ui/Modal.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import { purchasesApi } from '../../lib/api/purchases.js';

function formatPaymentDate(value, fallback) {
  return formatDateTime(value || fallback) || '—';
}

function formatPaymentDescription(purchaseNumber) {
  const billNo = String(purchaseNumber || '').trim();
  return billNo ? `${billNo} - PAYMENT (PURCHASE)` : 'PAYMENT (PURCHASE)';
}

const PurchaseTransactionsModal = ({ isOpen, purchaseId, onClose, onAddPayment }) => {
  const purchaseQuery = useQuery({
    queryKey: ['purchase', purchaseId, 'transactions-modal'],
    queryFn: () => purchasesApi.get(purchaseId),
    enabled: Boolean(isOpen && purchaseId),
  });

  const purchase = purchaseQuery.data?.data;
  const payments = Array.isArray(purchase?.payments) ? purchase.payments : [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={purchase ? `Transactions - Bill No: ${purchase.purchase_number}` : 'Transactions'}
    >
      {purchaseQuery.isLoading ? (
        <div className="py-4 text-sm text-gray-500">Loading transactions…</div>
      ) : purchaseQuery.isError || !purchase ? (
        <div className="py-4 text-sm text-red-600">Could not load transactions.</div>
      ) : payments.length === 0 ? (
        <div className="py-4 text-sm text-gray-500">No transactions for this purchase.</div>
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
                    {formatPaymentDescription(purchase.purchase_number)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {purchase.status !== 'cancelled' && onAddPayment ? (
                      <button
                        type="button"
                        title="Pay payment"
                        className="inline-flex items-center justify-center p-1 rounded hover:bg-green-50 text-green-600"
                        onClick={() => onAddPayment(purchase.id)}
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

PurchaseTransactionsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  purchaseId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onAddPayment: PropTypes.func,
};

PurchaseTransactionsModal.defaultProps = {
  purchaseId: null,
  onAddPayment: undefined,
};

export default PurchaseTransactionsModal;
