import clsx from 'clsx';
import PropTypes from 'prop-types';

import { useIsLgUp } from '../../hooks/useBreakpoint.js';
import { isModalCloseGuardActive } from '../../lib/modalCloseGuard.js';
import EmptyState from './EmptyState.jsx';
import Skeleton from './Skeleton.jsx';
import TableListFooter from './TableListFooter.jsx';
import { renderTableHeader } from './TableHeaderLabel.jsx';

const DataTable = ({
  columns,
  rows = [],
  loading = false,
  emptyTitle = 'No records found',
  emptyMessage = 'Once you add records they will appear here.',
  onRowClick = null,
  rowKey = 'id',
  embedded = false,
  getRowClassName = null,
  mobileCardRender = null,
  scrollClassName = '',
  visibleCount,
  totalCount,
  page = 1,
  totalPages = 1,
  countLabel = 'records',
  onPreviousPage,
  onNextPage,
  disablePrevious = false,
  disableNext = false,
  showCountFooter = true,
  perPage,
  onPerPageChange,
  perPageOptions,
  fitContainer = false,
  wrapCells = false,
}) => {
  const isLgUp = useIsLgUp();
  const renderMobileRow =
    typeof mobileCardRender === 'function'
      ? mobileCardRender
      : (row) => defaultMobileCardRender(row, columns);
  const useMobileCards = !isLgUp;
  const scrollMax = clsx(
    fitContainer ? 'overflow-y-auto overflow-x-hidden' : 'overflow-auto',
    scrollClassName ||
      (isLgUp ? 'max-h-[calc(100vh-240px)]' : 'max-h-[calc(100dvh-12rem)]')
  );
  const outerLoaded = embedded ? clsx(scrollMax, 'bg-transparent') : clsx('table-wrap', scrollMax);
  const tableClass = fitContainer ? 'table w-full table-fixed' : 'table min-w-max';
  const bodyCellClass = fitContainer || wrapCells
    ? 'whitespace-normal break-words align-top'
    : 'whitespace-nowrap';
  const headerThClass = (c) =>
    clsx('whitespace-normal leading-tight align-bottom', c.align && `text-${c.align}`);

  const resolvedVisible = visibleCount != null ? visibleCount : (rows || []).length;
  const resolvedTotal =
    totalCount != null && totalCount !== '' ? totalCount : resolvedVisible;
  const showFooter = showCountFooter && (loading || resolvedTotal != null || resolvedVisible > 0);

  const footer = showFooter ? (
    <TableListFooter
      visibleCount={resolvedVisible}
      totalCount={resolvedTotal}
      page={page}
      totalPages={totalPages}
      countLabel={countLabel}
      loading={loading}
      onPreviousPage={onPreviousPage}
      onNextPage={onNextPage}
      disablePrevious={disablePrevious}
      disableNext={disableNext}
      perPage={perPage}
      onPerPageChange={onPerPageChange}
      perPageOptions={perPageOptions}
    />
  ) : null;

  const listShellClass = embedded
    ? null
    : 'table-wrap overflow-hidden flex flex-col min-w-0';
  const listScrollClass = embedded ? clsx(scrollMax, 'bg-transparent') : scrollMax;

  if (loading) {
    return (
      <div className={listShellClass || undefined}>
        <div className={embedded ? listScrollClass : clsx(listScrollClass, listShellClass && 'min-h-0')}>
          <table className={tableClass}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} style={{ width: c.width }} className={headerThClass(c)}>
                    {renderTableHeader(c.header, c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key} className={bodyCellClass}>
                      <Skeleton />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {footer}
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className={listShellClass || undefined}>
        <div className={embedded ? 'px-3 py-6' : 'px-4 py-10'}>
          <EmptyState title={emptyTitle} message={emptyMessage} />
        </div>
        {footer}
      </div>
    );
  }

  if (useMobileCards) {
    const selectColumn = findColumn(columns, 'select');
    const actionColumns = findActionColumns(columns);

    return (
      <>
        <div className={clsx('space-y-2', !embedded && 'min-w-0')}>
          {rows.map((row, i) => {
            const key = rowKey ? row[rowKey] : i;
            const rowClass = getRowClassName ? getRowClassName(row) : '';
            return (
              <div
                key={key}
                className={clsx(
                  'rounded-lg border border-gray-200 bg-surface p-3 shadow-card',
                  rowClass
                )}
              >
                {selectColumn?.render ? (
                  <div className="mb-2 flex items-center gap-2 border-b border-gray-100 pb-2">
                    {selectColumn.render(row)}
                    <span className="text-[11px] font-medium text-gray-500">Select row</span>
                  </div>
                ) : null}
                <div
                  role={onRowClick ? 'button' : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? (e) => invokeRowClick(e, row, onRowClick) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (isModalCloseGuardActive()) return;
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  className={clsx('min-w-0', onRowClick ? 'cursor-pointer text-left w-full' : '')}
                >
                  {renderMobileRow(row)}
                </div>
                {actionColumns.length > 0 ? (
                  <MobileCardActions columns={actionColumns} row={row} />
                ) : null}
              </div>
            );
          })}
        </div>
        {footer}
      </>
    );
  }

  return (
    <div className={listShellClass || undefined}>
      <div
        className={clsx(
          listShellClass ? listScrollClass : outerLoaded,
          !listShellClass && '-mx-3 px-3 sm:mx-0 sm:px-0',
          'min-w-0'
        )}
      >
        <table className={tableClass}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width }} className={headerThClass(c)}>
                  {renderTableHeader(c.header, c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const rowClass = getRowClassName ? getRowClassName(row) : '';
              return (
                <tr
                  key={rowKey ? row[rowKey] : i}
                  className={clsx(onRowClick ? 'cursor-pointer' : '', rowClass)}
                  onClick={onRowClick ? (e) => invokeRowClick(e, row, onRowClick) : undefined}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={clsx(bodyCellClass, c.align && `text-${c.align}`, c.className, rowClass)}
                      style={{ width: c.width }}
                      onClick={c.key === 'select' ? stopRowClickBubble : undefined}
                    >
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
};

DataTable.propTypes = {
  columns: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      header: PropTypes.node,
      render: PropTypes.func,
      width: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      align: PropTypes.oneOf(['left', 'center', 'right']),
      className: PropTypes.string,
      headerWrap: PropTypes.bool,
    })
  ).isRequired,
  rows: PropTypes.array,
  loading: PropTypes.bool,
  emptyTitle: PropTypes.string,
  emptyMessage: PropTypes.string,
  onRowClick: PropTypes.func,
  rowKey: PropTypes.string,
  embedded: PropTypes.bool,
  getRowClassName: PropTypes.func,
  mobileCardRender: PropTypes.func,
  scrollClassName: PropTypes.string,
  visibleCount: PropTypes.number,
  totalCount: PropTypes.number,
  page: PropTypes.number,
  totalPages: PropTypes.number,
  countLabel: PropTypes.string,
  onPreviousPage: PropTypes.func,
  onNextPage: PropTypes.func,
  disablePrevious: PropTypes.bool,
  disableNext: PropTypes.bool,
  showCountFooter: PropTypes.bool,
  perPage: PropTypes.number,
  onPerPageChange: PropTypes.func,
  perPageOptions: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    })
  ),
  fitContainer: PropTypes.bool,
  wrapCells: PropTypes.bool,
};

function findColumn(columns, key) {
  return (columns || []).find((c) => c.key === key);
}

function findActionColumns(columns) {
  return (columns || []).filter(
    (c) => c.key && (c.key === 'actions' || c.key === 'action') && typeof c.render === 'function'
  );
}

function isMobileMetaColumn(key) {
  return key === 'actions' || key === 'action' || key === 'select';
}

function stopRowClickBubble(e) {
  e.stopPropagation();
}

function shouldIgnoreRowClick(e) {
  return Boolean(
    e.target.closest('button, a, input, select, textarea, label, [data-stop-row-click]')
  );
}

function invokeRowClick(e, row, handler) {
  if (isModalCloseGuardActive()) return;
  if (shouldIgnoreRowClick(e)) return;
  handler(row);
}

const MobileCardActions = ({ columns, row }) => (
  <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5 border-t border-gray-100 pt-2 [&_button]:min-h-9 [&_button]:min-w-9 [&_button]:inline-flex [&_button]:items-center [&_button]:justify-center">
    {columns.map((c) => (
      <div key={c.key}>{c.render(row)}</div>
    ))}
  </div>
);

MobileCardActions.propTypes = {
  columns: PropTypes.array.isRequired,
  row: PropTypes.object.isRequired,
};

function defaultMobileCardRender(row, columns) {
  const cells = (columns || []).filter((c) => c.key && !isMobileMetaColumn(c.key));
  const pick = cells.slice(0, 6);
  if (pick.length === 0) {
    return <div className="text-sm text-gray-700">Record</div>;
  }
  return (
    <div className="space-y-2 min-w-0">
      {pick.map((c) => (
        <div key={c.key} className="flex items-start justify-between gap-3 text-xs">
          <span className="shrink-0 text-gray-500 font-medium">{stripHeader(c.header, c)}</span>
          <span className="min-w-0 text-right text-gray-900 break-words">
            {c.render ? c.render(row) : formatCell(row[c.key])}
          </span>
        </div>
      ))}
    </div>
  );
}

function stripHeader(header, column) {
  if (typeof header === 'string' && header.trim()) return header;
  if (column?.columnPickerLabel) return column.columnPickerLabel;
  if (column?.key === 'image') return 'Image';
  return 'Field';
}

function formatCell(val) {
  if (val == null || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  return String(val);
}

export default DataTable;
