import { formatCurrency } from '@wrs/shared';
import PropTypes from 'prop-types';

import { calculateVendorOutstandingAmounts } from '../../pages/laundry/laundrySlipData.js';

const VendorOutstandingSummary = ({
  vendorOutstanding,
  currentBillAmount = 0,
  currentBillId = null,
  compact = false,
}) => {
  if (!vendorOutstanding?.totals?.billCount) return null;

  const { currentBill, oldPending, totalPending } = calculateVendorOutstandingAmounts({
    outstanding: vendorOutstanding,
    currentBillAmount,
    currentBillId,
  });

  return (
    <div className={compact ? '' : 'card p-3'}>
      {!compact ? (
        <h3 className="text-xs font-semibold text-gray-900 mb-2 uppercase">Vendor outstanding</h3>
      ) : null}
      <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-gray-600">Current Bill Amount</span>
          <strong className="tabular-nums text-gray-900">{formatCurrency(currentBill)}</strong>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-1.5">
          <span className="text-gray-600">Old Pending Bill Amount</span>
          <strong className="tabular-nums text-gray-900">{formatCurrency(oldPending)}</strong>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-1.5">
          <span className="text-gray-700 font-medium">Final Total Pending Amount</span>
          <strong className="tabular-nums text-brand">{formatCurrency(totalPending)}</strong>
        </div>
      </div>
    </div>
  );
};

VendorOutstandingSummary.propTypes = {
  vendorOutstanding: PropTypes.shape({
    totals: PropTypes.shape({
      totalRemaining: PropTypes.number,
      billCount: PropTypes.number,
    }),
    bills: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string,
        remaining: PropTypes.number,
      })
    ),
  }),
  currentBillAmount: PropTypes.number,
  currentBillId: PropTypes.string,
  compact: PropTypes.bool,
};

export default VendorOutstandingSummary;
