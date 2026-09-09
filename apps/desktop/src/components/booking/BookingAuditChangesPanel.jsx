import PropTypes from 'prop-types';

import {
  AuditChangeFieldCell,
  AuditChangeKindBadge,
  AuditChangeValueCell,
} from '../audit/auditChangeDisplay.jsx';
import TableHeaderLabel from '../ui/TableHeaderLabel.jsx';

function AuditChangesList({ rows, dense = false }) {
  const gridCols = dense
    ? 'grid-cols-[minmax(4.5rem,24%)_minmax(0,1fr)_minmax(0,1fr)_1.25rem]'
    : 'grid-cols-[minmax(5rem,22%)_minmax(0,1fr)_minmax(0,1fr)_2.5rem]';
  const textSize = dense ? 'text-[10px]' : 'text-[11px]';

  return (
    <div className={textSize}>
      <div
        className={`grid ${gridCols} gap-x-2 gap-y-0.5 px-2 py-1 bg-gray-50 text-gray-600 font-medium border-b border-gray-100`}
      >
        <span>
          <TableHeaderLabel>Field</TableHeaderLabel>
        </span>
        <span className="border-r border-gray-200 pr-1">
          <TableHeaderLabel>Previous</TableHeaderLabel>
        </span>
        <span>
          <TableHeaderLabel>New</TableHeaderLabel>
        </span>
        <span className="text-center" />
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map((row) => (
          <div
            key={row.path || row.label}
            className={`grid ${gridCols} gap-x-2 gap-y-1 px-2 py-1 items-start`}
          >
            <AuditChangeFieldCell row={row} dense={dense} />
            <div className="min-w-0 text-gray-600 border-r border-gray-100 pr-2 overflow-hidden">
              <AuditChangeValueCell value={row.previous} dense={dense} />
            </div>
            <div className="min-w-0 text-gray-900 overflow-hidden">
              <AuditChangeValueCell value={row.next} dense={dense} />
            </div>
            <div className="flex justify-center pt-0.5">
              <AuditChangeKindBadge kind={row.kind} dense={dense} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

AuditChangesList.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  dense: PropTypes.bool,
};

/**
 * @param {import('@wrs/shared').SnapshotChangeRow[]} changes
 * @param {number} limit
 */
function sliceWithMeta(changes, limit) {
  const list = changes || [];
  return {
    rows: list.slice(0, limit),
    truncated: list.length > limit,
    total: list.length,
  };
}

const BookingAuditChangesPanel = ({
  billChanges,
  productChanges,
  dense = false,
  limitPerSection = null,
  emptyMessage = 'No field changes for this edit.',
}) => {
  const billLimit = limitPerSection ?? (dense ? 6 : 12);
  const productLimit = limitPerSection ?? (dense ? 6 : 12);
  const bill = sliceWithMeta(billChanges, billLimit);
  const product = sliceWithMeta(productChanges, productLimit);
  const hasBill = bill.total > 0;
  const hasProduct = product.total > 0;

  if (!hasBill && !hasProduct) {
    return (
      <p className={dense ? 'text-[10px] text-gray-500 px-2 py-1.5' : 'text-xs text-gray-500 px-2.5 py-3'}>
        {emptyMessage}
      </p>
    );
  }

  const sectionTitleClass = dense
    ? 'text-[10px] font-semibold text-gray-800 px-2 py-1 bg-gray-50 border-b border-gray-100'
    : 'text-xs font-semibold text-gray-800 px-2.5 py-1.5 bg-gray-50 border-b border-gray-100';

  const moreClass = dense
    ? 'text-[9px] text-gray-500 px-1.5 py-0.5 border-t border-gray-100'
    : 'text-[10px] text-gray-500 px-2 py-1 border-t border-gray-100';

  return (
    <div className={dense ? 'text-[10px]' : 'text-sm'}>
      {hasBill ? (
        <section className={hasProduct ? 'border-b border-gray-200' : ''}>
          <p className={sectionTitleClass}>Bill</p>
          <AuditChangesList rows={bill.rows} dense={dense} />
          {bill.truncated ? (
            <p className={moreClass}>+{bill.total - bill.rows.length} more bill change(s)</p>
          ) : null}
        </section>
      ) : null}
      {hasProduct ? (
        <section>
          <p className={sectionTitleClass}>Products &amp; accessories</p>
          <AuditChangesList rows={product.rows} dense={dense} />
          {product.truncated ? (
            <p className={moreClass}>
              +{product.total - product.rows.length} more product change(s)
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
};

BookingAuditChangesPanel.propTypes = {
  billChanges: PropTypes.arrayOf(PropTypes.object),
  productChanges: PropTypes.arrayOf(PropTypes.object),
  dense: PropTypes.bool,
  limitPerSection: PropTypes.number,
  emptyMessage: PropTypes.string,
};

BookingAuditChangesPanel.defaultProps = {
  billChanges: [],
  productChanges: [],
  dense: false,
  limitPerSection: null,
  emptyMessage: 'No field changes for this edit.',
};

export default BookingAuditChangesPanel;
