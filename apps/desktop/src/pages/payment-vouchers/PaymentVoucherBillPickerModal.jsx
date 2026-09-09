import { formatCurrency, formatDate } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { fieldShellClass } from '../../lib/formValidation.js';

function purchasePending(purchase) {
  return Math.max(0, Number(purchase?.total_amount || 0) - Number(purchase?.advance || 0));
}

function billBalance(bill, billKind) {
  if (billKind === 'washing') return Number(bill?.washing_balance ?? 0);
  return purchasePending(bill);
}

function sumBillBalances(bills, billKind) {
  return bills.reduce((sum, bill) => sum + billBalance(bill, billKind), 0);
}

function billRowLabel(bill, billKind) {
  if (billKind === 'washing') {
    return `${bill.job_no}${bill.vendor_name ? ` · ${bill.vendor_name}` : ''} · ${formatDate(bill.laundry_date)}`;
  }
  return `${bill.purchase_number}${bill.vendor_account_name ? ` · ${bill.vendor_account_name}` : ''} · ${formatDate(bill.purchase_date)}`;
}

function billKindTitle(billKind) {
  return billKind === 'washing' ? 'Washing' : 'Purchase';
}

const PaymentVoucherBillPickerModal = ({
  isOpen,
  onClose,
  onConfirm,
  billKind,
  bills,
  initialSelectedIds,
  vendorName,
}) => {
  const [draftBillIds, setDraftBillIds] = useState([]);

  useEffect(() => {
    if (!isOpen) return;
    setDraftBillIds(Array.isArray(initialSelectedIds) ? [...initialSelectedIds] : []);
  }, [isOpen, initialSelectedIds]);

  const draftSelectedBills = useMemo(
    () => bills.filter((bill) => draftBillIds.includes(bill.id)),
    [bills, draftBillIds]
  );

  const draftTotal = useMemo(
    () => sumBillBalances(draftSelectedBills, billKind),
    [billKind, draftSelectedBills]
  );

  const toggleDraftBill = (billId, checked) => {
    setDraftBillIds((prev) =>
      checked ? [...prev, billId] : prev.filter((id) => id !== billId)
    );
  };

  const selectAllDraft = () => {
    setDraftBillIds(bills.map((bill) => bill.id));
  };

  const clearDraft = () => {
    setDraftBillIds([]);
  };

  const handleConfirm = () => {
    onConfirm(draftBillIds);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Select ${billKindTitle(billKind)} bills`}
      size="lg"
      layerClass="z-[60]"
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="text-xs text-gray-600 tabular-nums">
            {draftBillIds.length > 0 ? (
              <>
                <span className="font-medium text-gray-900">{draftBillIds.length}</span> bill(s) ·{' '}
                <span className="font-semibold text-gray-900">{formatCurrency(draftTotal)}</span>
              </>
            ) : (
              'No bills selected'
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>OK</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        {vendorName ? (
          <p className="text-xs text-gray-600">
            Vendor: <span className="font-medium text-gray-900">{vendorName}</span>
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            {bills.length} pending bill{bills.length === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2 text-[11px]">
            <button type="button" className="text-brand hover:underline" onClick={selectAllDraft}>
              Select all
            </button>
            {draftBillIds.length > 0 ? (
              <button type="button" className="text-gray-500 hover:underline" onClick={clearDraft}>
                Clear
              </button>
            ) : null}
          </div>
        </div>

        <div
          className={fieldShellClass(
            '',
            'border border-gray-200 rounded-lg max-h-72 overflow-y-auto bg-surface divide-y divide-gray-100'
          )}
        >
          {bills.map((bill) => {
            const balance = billBalance(bill, billKind);
            const checked = draftBillIds.includes(bill.id);
            return (
              <label
                key={bill.id}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 ${
                  checked ? 'bg-gray-50' : ''
                }`}
              >
                <input
                  type="checkbox"
                  className="shrink-0"
                  checked={checked}
                  onChange={(e) => toggleDraftBill(bill.id, e.target.checked)}
                />
                <span className="flex-1 min-w-0 truncate text-xs text-gray-700">
                  {billRowLabel(bill, billKind)}
                </span>
                <span className="shrink-0 tabular-nums text-xs font-medium text-gray-900">
                  {formatCurrency(balance)}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};

PaymentVoucherBillPickerModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  billKind: PropTypes.oneOf(['purchase', 'washing']).isRequired,
  bills: PropTypes.arrayOf(PropTypes.object).isRequired,
  initialSelectedIds: PropTypes.arrayOf(PropTypes.string),
  vendorName: PropTypes.string,
};

export default PaymentVoucherBillPickerModal;
