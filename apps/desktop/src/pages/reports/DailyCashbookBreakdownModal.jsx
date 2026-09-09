import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useMemo } from 'react';

import Modal from '../../components/ui/Modal.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import { reportsApi } from '../../lib/api/reports.js';
import { formatFinancialRecordDateTime } from '../../lib/listTimestampColumns.js';

function BreakdownTable({ title, rows, amountClassName, total, emptyLabel }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="text-xs font-semibold text-gray-900 mb-2">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500 py-2">{emptyLabel}</p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-md">
          <table className="table w-full text-xs">
            <thead>
              <tr>
                <th className="text-left">
                  <TableHeaderLabel>Date &amp; time</TableHeaderLabel>
                </th>
                <th className="text-left">
                  <TableHeaderLabel>Bill number</TableHeaderLabel>
                </th>
                <th className="text-left">
                  <TableHeaderLabel>Name</TableHeaderLabel>
                </th>
                <th className="text-left">
                  <TableHeaderLabel>Details</TableHeaderLabel>
                </th>
                <th className="text-right">
                  <TableHeaderLabel align="right">Amount</TableHeaderLabel>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.row_id} className="border-b border-gray-100">
                  <td className="py-1.5 pr-2 text-gray-900 whitespace-nowrap tabular-nums">
                    {formatFinancialRecordDateTime(r)}
                  </td>
                  <td className="py-1.5 pr-2 text-gray-900 whitespace-nowrap">{r.ref_no || '—'}</td>
                  <td className="py-1.5 px-2 text-gray-800">{r.customer_name || '—'}</td>
                  <td className="py-1.5 px-2 text-gray-700">{r.details || '—'}</td>
                  <td className={`py-1.5 pl-2 text-right tabular-nums ${amountClassName}`}>
                    {formatCurrency(r.amount)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-gray-200 bg-gray-50">
                <td colSpan={4} className="py-1.5 pr-2 font-semibold text-gray-900">
                  Total
                </td>
                <td className={`py-1.5 pl-2 text-right font-semibold tabular-nums ${amountClassName}`}>
                  {formatCurrency(total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

BreakdownTable.propTypes = {
  title: PropTypes.string.isRequired,
  rows: PropTypes.arrayOf(
    PropTypes.shape({
      row_id: PropTypes.string,
      ref_no: PropTypes.string,
      customer_name: PropTypes.string,
      details: PropTypes.string,
      amount: PropTypes.number,
      created_at: PropTypes.string,
      entry_date: PropTypes.string,
      payment_date: PropTypes.string,
    })
  ).isRequired,
  amountClassName: PropTypes.string.isRequired,
  total: PropTypes.number.isRequired,
  emptyLabel: PropTypes.string.isRequired,
};

const DailyCashbookBreakdownModal = ({
  isOpen,
  onClose,
  accountId,
  accountName,
  date,
  expectedIncome,
  expectedExpense,
}) => {
  const listParams = useMemo(() => {
    if (!accountId || !date) return null;
    return { account_id: accountId, date };
  }, [accountId, date]);

  const { data: res, isLoading, isError } = useQuery({
    queryKey: ['reports', 'daily-cashbook-lines', listParams],
    queryFn: () => reportsApi.dailyCashbookLines(listParams),
    enabled: Boolean(isOpen && listParams),
  });

  const payload = res?.data;
  const incomeLines = payload?.income_lines ?? [];
  const expenseLines = payload?.expense_lines ?? [];
  const summary = payload?.summary;
  const meta = payload?.meta;
  const incomeTotal = summary?.income_total ?? expectedIncome ?? 0;
  const expenseTotal = summary?.expense_total ?? expectedExpense ?? 0;

  const title = accountName
    ? `${accountName} — ${date ? formatDate(date) : ''}`
    : 'Amount breakdown';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-red-700">Could not load breakdown. Please try again.</p>
      ) : (
        <>
          {meta?.income_truncated || meta?.expense_truncated ? (
            <p className="text-xs text-gray-500 mb-3">
              Showing first {meta?.row_limit ?? 500} lines per section. Totals include all transactions.
            </p>
          ) : null}
          <BreakdownTable
            title="Income (Debit)"
            rows={incomeLines}
            amountClassName="text-green-700 font-semibold"
            total={incomeTotal}
            emptyLabel="No income for this day."
          />
          <BreakdownTable
            title="Expense (Credit)"
            rows={expenseLines}
            amountClassName="text-red-700 font-semibold"
            total={expenseTotal}
            emptyLabel="No expense for this day."
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 pt-2 border-t border-gray-100">
            <span>
              Net:{' '}
              <span className="font-semibold text-brand tabular-nums">
                {formatCurrency(summary?.net ?? incomeTotal - expenseTotal)}
              </span>
            </span>
          </div>
        </>
      )}
    </Modal>
  );
};

DailyCashbookBreakdownModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  accountId: PropTypes.string,
  accountName: PropTypes.string,
  date: PropTypes.string,
  expectedIncome: PropTypes.number,
  expectedExpense: PropTypes.number,
};

export default DailyCashbookBreakdownModal;
