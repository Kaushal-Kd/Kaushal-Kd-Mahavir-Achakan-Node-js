import PropTypes from 'prop-types';

import { formatChangesWhenLabel } from '../../lib/systemLogExport.js';
import AuditChangeRowsTable from './AuditChangeRowsTable.jsx';

function sessionSummary(group) {
  const billCount = group.rows.filter((r) => r.changeType === 'bill').length;
  const productCount = group.rows.filter((r) => r.changeType === 'product').length;
  const parts = [];
  if (billCount) parts.push(`${billCount} bill`);
  if (productCount) parts.push(`${productCount} product`);
  if (!parts.length) return 'No field changes';
  return parts.join(' · ');
}

const AuditChangeLogGroups = ({
  groups,
  loading = false,
  emptyTitle = 'No changes recorded',
  emptyMessage = 'Changes appear here after create, edit, or updates.',
  scrollClassName = 'max-h-[min(70vh,640px)]',
}) => {
  const list = groups || [];

  if (loading) {
    return (
      <AuditChangeRowsTable
        rows={[]}
        loading
        emptyTitle={emptyTitle}
        emptyMessage={emptyMessage}
        scrollClassName={scrollClassName}
      />
    );
  }

  if (!list.length) {
    return (
      <AuditChangeRowsTable
        rows={[]}
        loading={false}
        emptyTitle={emptyTitle}
        emptyMessage={emptyMessage}
        scrollClassName={scrollClassName}
      />
    );
  }

  const totalRows = list.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className={`overflow-y-auto overflow-x-hidden min-w-0 space-y-3 ${scrollClassName}`}>
      {list.map((group) => (
        <section
          key={group.logId}
          className="rounded-lg border border-gray-200 overflow-hidden bg-white"
        >
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs">
            <time className="font-medium text-gray-900 whitespace-nowrap">
              {formatChangesWhenLabel(group.createdAt)}
            </time>
            {group.action ? (
              <span className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-gray-700">
                {group.action}
              </span>
            ) : null}
            {group.changeCount != null ? (
              <span className="text-gray-500">Edit #{group.changeCount}</span>
            ) : null}
            {group.billNo ? (
              <span className="font-mono text-gray-600">{group.billNo}</span>
            ) : null}
            {group.person && group.person !== '—' ? (
              <span className="text-gray-600">{group.person}</span>
            ) : null}
            <span className="text-gray-500 ml-auto">{sessionSummary(group)}</span>
          </header>
          {group.rows.length ? (
            <AuditChangeRowsTable
              rows={group.rows}
              showCount={false}
              scrollClassName="max-h-none"
              embedded
            />
          ) : (
            <p className="px-3 py-4 text-xs text-gray-500 text-center">No field-level changes recorded.</p>
          )}
        </section>
      ))}
      <p className="text-[10px] text-gray-500 text-right px-1 pb-1">
        {totalRows} change{totalRows === 1 ? '' : 's'} across {list.length} session
        {list.length === 1 ? '' : 's'}
      </p>
    </div>
  );
};

AuditChangeLogGroups.propTypes = {
  groups: PropTypes.arrayOf(
    PropTypes.shape({
      logId: PropTypes.string.isRequired,
      createdAt: PropTypes.string,
      action: PropTypes.string,
      person: PropTypes.string,
      billNo: PropTypes.string,
      changeCount: PropTypes.number,
      rows: PropTypes.arrayOf(PropTypes.object).isRequired,
    })
  ),
  loading: PropTypes.bool,
  emptyTitle: PropTypes.string,
  emptyMessage: PropTypes.string,
  scrollClassName: PropTypes.string,
};

export default AuditChangeLogGroups;
