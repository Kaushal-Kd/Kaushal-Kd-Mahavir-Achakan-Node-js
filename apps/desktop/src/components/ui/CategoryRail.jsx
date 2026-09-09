import clsx from 'clsx';
import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import { useIsLgUp } from '../../hooks/useBreakpoint.js';

/**
 * Category filter: vertical rail on lg+, horizontal chips on mobile.
 */
const CategoryRail = ({
  counts = null,
  value = 'all',
  onChange,
  loading = false,
  title = 'Categories',
  subtitle = '',
  emptyHint = '',
  extraItems = [],
}) => {
  const [filter, setFilter] = useState('');
  const isLgUp = useIsLgUp();

  const data = counts || { total: 0, uncategorized: 0, by_category: [] };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return data.by_category;
    return data.by_category.filter((c) => c.label.toLowerCase().includes(q));
  }, [filter, data.by_category]);

  const selectAll = value === 'all' || value == null;

  const chipBtn = (label, count, active, onClick, extraClass) => (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-brand bg-brand-light text-brand'
          : 'border-gray-200 bg-surface text-gray-700 hover:border-brand hover:text-brand',
        extraClass
      )}
    >
      <span className="max-w-[8rem] truncate">{label}</span>
      <span
        className={clsx(
          'rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
          active ? 'bg-white text-brand' : 'bg-gray-100 text-gray-600'
        )}
      >
        {count}
      </span>
    </button>
  );

  if (!isLgUp) {
    return (
      <div className="w-full min-w-0 space-y-2">
        {title ? <h3 className="text-sm font-semibold text-gray-900 px-0.5">{title}</h3> : null}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
          {chipBtn('All', data.total, selectAll, () => onChange('all'))}
          {extraItems.map((ex) =>
            chipBtn(
              ex.label,
              ex.count,
              value === ex.id,
              () => onChange(ex.id),
              ex.tone === 'danger'
                ? value === ex.id
                  ? 'border-red-300 bg-red-50 text-red-700'
                  : 'border-red-200 bg-surface text-red-600 hover:border-red-300 hover:bg-red-50'
                : ex.className
            )
          )}
          {filtered.map((c) =>
            chipBtn(c.label, c.count, value === c.id, () => onChange(c.id))
          )}
        </div>
        {loading && data.by_category.length === 0 ? (
          <p className="text-[11px] text-gray-400 px-0.5">Loading...</p>
        ) : null}
      </div>
    );
  }

  return (
    <aside className="card p-0 w-64 shrink-0 flex flex-col self-start sticky top-4 max-lg:hidden">
      <div className="px-4 pt-4 pb-2 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {subtitle ? <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p> : null}
      </div>

      {data.by_category.length > 4 ? (
        <div className="px-3 pt-3">
          <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded border border-gray-100">
            <Search size={13} className="text-gray-400" />
            <input
              className="flex-1 bg-transparent outline-none text-xs min-w-0"
              placeholder="Filter categories..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto max-h-[calc(100vh-220px)] py-2">
        <RailRow
          label="All"
          count={data.total}
          active={selectAll}
          onClick={() => onChange('all')}
          bold
        />

        {extraItems.map((ex) => (
          <RailRow
            key={ex.id}
            label={ex.label}
            count={ex.count}
            active={value === ex.id}
            onClick={() => onChange(ex.id)}
            tone={ex.tone}
          />
        ))}

        {filtered.map((c) => (
          <RailRow
            key={c.id}
            label={c.label}
            count={c.count}
            active={value === c.id}
            onClick={() => onChange(c.id)}
          />
        ))}

        {!loading && data.by_category.length === 0 && emptyHint ? (
          <div className="px-4 py-3 text-[11px] text-gray-400">{emptyHint}</div>
        ) : null}

        {loading && data.by_category.length === 0 ? (
          <div className="px-4 py-3 text-[11px] text-gray-400">Loading...</div>
        ) : null}
      </div>
    </aside>
  );
};

const RailRow = ({ label, count, active, onClick, bold, muted, tone }) => (
  <button
    type="button"
    onClick={onClick}
    className={clsx(
      'w-full flex items-center justify-between gap-2 px-4 py-2 text-left text-sm transition-colors',
      tone === 'danger' && active && 'bg-red-50 text-red-700 font-medium',
      tone === 'danger' && !active && 'text-red-600 hover:bg-red-50',
      tone !== 'danger' && active && 'bg-brand-light text-brand font-medium',
      tone !== 'danger' && !active && 'hover:bg-gray-50 text-gray-700',
      bold && !active && 'font-semibold text-gray-900',
      muted && !active && 'text-gray-500 italic'
    )}
  >
    <span className="truncate">{label}</span>
    <span
      className={clsx(
        'text-xs px-1.5 py-0.5 rounded-full min-w-[22px] text-center',
        tone === 'danger' && active && 'bg-white text-red-700',
        tone === 'danger' && !active && 'bg-red-50 text-red-600',
        tone !== 'danger' && active && 'bg-white text-brand',
        tone !== 'danger' && !active && 'bg-gray-100 text-gray-600'
      )}
    >
      {count}
    </span>
  </button>
);

RailRow.propTypes = {
  label: PropTypes.string.isRequired,
  count: PropTypes.number.isRequired,
  active: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  bold: PropTypes.bool,
  muted: PropTypes.bool,
  tone: PropTypes.string,
};

CategoryRail.propTypes = {
  counts: PropTypes.shape({
    total: PropTypes.number,
    uncategorized: PropTypes.number,
    by_category: PropTypes.array,
  }),
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  loading: PropTypes.bool,
  title: PropTypes.string,
  subtitle: PropTypes.string,
  emptyHint: PropTypes.string,
  extraItems: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      count: PropTypes.number.isRequired,
      tone: PropTypes.string,
      className: PropTypes.string,
    })
  ),
};

export default CategoryRail;
