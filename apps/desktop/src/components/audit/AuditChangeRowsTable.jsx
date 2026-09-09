import PropTypes from 'prop-types';

import { formatChangesWhenLabel } from '../../lib/systemLogExport.js';
import {
  AuditChangeFieldCell,
  AuditChangeKindBadge,
  AuditChangeValueCell,
} from './auditChangeDisplay.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import Skeleton from '../ui/Skeleton.jsx';
import TableHeaderLabel from '../ui/TableHeaderLabel.jsx';
import TableListFooter from '../ui/TableListFooter.jsx';

const GRID_COLS =
  'grid-cols-[minmax(8.25rem,10%)_minmax(2.5rem,4%)_minmax(3.25rem,5%)_minmax(2.5rem,8%)_1.25rem_minmax(3.5rem,12%)_minmax(3rem,10%)_minmax(0,1fr)_minmax(0,1fr)]';

function changeTypeLabel(changeType) {
  return changeType === 'product' ? 'Product' : 'Bill';
}

function changeTypeClass(changeType) {
  return changeType === 'product'
    ? 'border-brand text-brand bg-surface'
    : 'border-gray-300 text-gray-700 bg-surface';
}

function AuditChangeDenseRow({ row }) {
  const itemText =
    row.changeType === 'product' && row.itemLabel ? row.itemLabel : '—';

  return (
    <div
      className={`grid ${GRID_COLS} gap-x-1.5 gap-y-0.5 px-2 py-1 items-start border-b border-gray-100 hover:bg-gray-50 text-[10px] leading-snug min-w-0`}
    >
      <time className="text-gray-800 shrink-0 whitespace-nowrap">
        {formatChangesWhenLabel(row.created_at)}
      </time>

      <span
        className={`inline-flex w-fit rounded border px-1 py-0 text-[9px] font-medium leading-tight ${changeTypeClass(row.changeType)}`}
      >
        {changeTypeLabel(row.changeType)}
      </span>

      {row.action ? (
        <span className="rounded border border-gray-200 bg-gray-50 px-1 py-0 text-gray-700 leading-tight break-words">
          {row.action}
        </span>
      ) : (
        <span className="text-gray-400">—</span>
      )}

      <span className="min-w-0 text-gray-600 break-words">
        {row.person && row.person !== '—' ? row.person : '—'}
      </span>

      <div className="flex justify-center pt-px">
        <AuditChangeKindBadge kind={row.kind} dense />
      </div>

      <div className="min-w-0">
        <AuditChangeFieldCell row={row} dense />
      </div>

      <span className="min-w-0 text-gray-800 break-words">{itemText}</span>

      <div className="min-w-0 text-gray-600 border-r border-gray-100 pr-1.5">
        <AuditChangeValueCell value={row.oldValue} dense />
      </div>

      <div className="min-w-0 text-gray-900">
        <AuditChangeValueCell value={row.newValue} dense />
      </div>
    </div>
  );
}

AuditChangeDenseRow.propTypes = {
  row: PropTypes.object.isRequired,
};

function AuditChangeDenseHeader() {
  return (
    <div
      className={`grid ${GRID_COLS} gap-x-1.5 gap-y-0.5 px-2 py-1 bg-gray-50 text-gray-600 font-medium border-b border-gray-200 text-[10px] leading-tight sticky top-0 z-10`}
    >
      <span>
        <TableHeaderLabel>When</TableHeaderLabel>
      </span>
      <span>
        <TableHeaderLabel>Type</TableHeaderLabel>
      </span>
      <span>
        <TableHeaderLabel>Action</TableHeaderLabel>
      </span>
      <span>
        <TableHeaderLabel>Person</TableHeaderLabel>
      </span>
      <span className="text-center">
        <TableHeaderLabel nowrap>±</TableHeaderLabel>
      </span>
      <span>
        <TableHeaderLabel>Field</TableHeaderLabel>
      </span>
      <span>
        <TableHeaderLabel>Item</TableHeaderLabel>
      </span>
      <span className="border-r border-gray-200 pr-1.5">
        <TableHeaderLabel>Old value</TableHeaderLabel>
      </span>
      <span>
        <TableHeaderLabel>New value</TableHeaderLabel>
      </span>
    </div>
  );
}

const AuditChangeRowsTable = ({
  rows,
  loading = false,
  emptyTitle = 'No changes recorded',
  emptyMessage = 'Changes appear here after create, edit, or updates.',
  scrollClassName = 'max-h-[min(70vh,640px)]',
  showCount = true,
  totalCount,
  embedded = false,
}) => {
  const list = rows || [];
  const count = totalCount ?? list.length;

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <Skeleton className="h-7 w-full rounded-none" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full rounded-none border-t border-gray-100" />
        ))}
      </div>
    );
  }

  if (!list.length) {
    const emptyWrap = embedded ? (
      <div className="px-2 py-6">
        <EmptyState title={emptyTitle} message={emptyMessage} />
      </div>
    ) : (
      <div className="px-2 py-8">
        <EmptyState title={emptyTitle} message={emptyMessage} />
      </div>
    );
    return emptyWrap;
  }

  const tableBody = (
    <>
      <AuditChangeDenseHeader />
      {list.map((row) => (
        <AuditChangeDenseRow key={row.id} row={row} />
      ))}
    </>
  );

  if (embedded) {
    return (
      <div className="min-w-0 w-full">
        {tableBody}
      </div>
    );
  }

  return (
    <div className="min-w-0 w-full flex flex-col rounded-lg border border-gray-200 overflow-hidden">
      <div className={`overflow-y-auto overflow-x-hidden min-w-0 ${scrollClassName}`}>
        {tableBody}
      </div>
      {showCount ? (
        <TableListFooter
          visibleCount={list.length}
          totalCount={count}
          countLabel="changes"
          loading={false}
        />
      ) : null}
    </div>
  );
};

AuditChangeRowsTable.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.object),
  loading: PropTypes.bool,
  emptyTitle: PropTypes.string,
  emptyMessage: PropTypes.string,
  scrollClassName: PropTypes.string,
  columnPickerId: PropTypes.string,
  showColumnPicker: PropTypes.bool,
  showCount: PropTypes.bool,
  totalCount: PropTypes.number,
  embedded: PropTypes.bool,
};

export default AuditChangeRowsTable;
