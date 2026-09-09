import PropTypes from 'prop-types';

import { TABLE_PER_PAGE_OPTIONS } from '../../lib/tablePerPage.js';
import Button from './Button.jsx';
import Select from './Select.jsx';

/**
 * Build footer summary text for list tables.
 * @param {{ visibleCount?: number, totalCount?: number, page?: number, totalPages?: number, countLabel?: string, loading?: boolean }} opts
 */
export function formatTableCountText(opts = {}) {
  if (opts.loading) return 'Loading…';

  const label = opts.countLabel || 'records';
  const visible = Math.max(0, Number(opts.visibleCount) || 0);
  const total =
    opts.totalCount != null && opts.totalCount !== ''
      ? Math.max(0, Number(opts.totalCount) || 0)
      : visible;
  const page = Math.max(1, Number(opts.page) || 1);
  const totalPages = Math.max(1, Number(opts.totalPages) || 1);
  const showPage = totalPages > 1;

  if (visible < total) {
    const base = `Showing ${visible} of ${total} ${label}`;
    return showPage ? `${base} (page ${page} of ${totalPages})` : base;
  }

  const base = `${total} ${label}`;
  return showPage ? `${base} (page ${page} of ${totalPages})` : base;
}

export default function TableListFooter({
  visibleCount,
  totalCount,
  page = 1,
  totalPages = 1,
  countLabel = 'records',
  loading = false,
  onPreviousPage,
  onNextPage,
  disablePrevious = false,
  disableNext = false,
  className = '',
  perPage,
  onPerPageChange,
  perPageOptions = TABLE_PER_PAGE_OPTIONS,
}) {
  const showPagination =
    typeof onPreviousPage === 'function' && typeof onNextPage === 'function';
  const showPerPageSelect = typeof onPerPageChange === 'function';

  const text = formatTableCountText({
    visibleCount,
    totalCount,
    page,
    totalPages,
    countLabel,
    loading,
  });

  if (!text && !showPagination && !showPerPageSelect) return null;

  return (
    <div
      className={[
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-2',
        'border-t border-gray-200 bg-gray-50/60 px-4 py-3 text-xs text-gray-600',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="tabular-nums min-w-0 leading-snug">{text}</span>
      {showPerPageSelect || showPagination ? (
        <div className="flex flex-nowrap items-center gap-2 shrink-0">
          {showPerPageSelect ? (
            <Select
              label=""
              aria-label="Rows per page"
              value={String(perPage ?? perPageOptions[0]?.value ?? '20')}
              onChange={(e) => onPerPageChange(Number(e.target.value) || 20)}
              options={perPageOptions}
              disabled={loading}
              className="!w-auto shrink-0"
              selectClassName="!w-auto min-w-[6.75rem] max-w-[6.75rem] h-8 py-1 pl-2.5 pr-7 text-xs leading-normal"
            />
          ) : null}
          {showPagination ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 min-w-[5.25rem] px-3"
                disabled={disablePrevious || loading}
                onClick={onPreviousPage}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 min-w-[5.25rem] px-3"
                disabled={disableNext || loading}
                onClick={onNextPage}
              >
                Next
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

TableListFooter.propTypes = {
  visibleCount: PropTypes.number,
  totalCount: PropTypes.number,
  page: PropTypes.number,
  totalPages: PropTypes.number,
  countLabel: PropTypes.string,
  loading: PropTypes.bool,
  onPreviousPage: PropTypes.func,
  onNextPage: PropTypes.func,
  disablePrevious: PropTypes.bool,
  disableNext: PropTypes.bool,
  className: PropTypes.string,
  perPage: PropTypes.number,
  onPerPageChange: PropTypes.func,
  perPageOptions: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    })
  ),
};
