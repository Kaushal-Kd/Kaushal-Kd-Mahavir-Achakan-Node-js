import PropTypes from 'prop-types';
import { FilterX, Search } from 'lucide-react';

import Button from '../ui/Button.jsx';

/**
 * Single-line filters for product / accessory catalog lists.
 */
const CompactCatalogFilters = ({
  searchValue,
  searchPlaceholder,
  onSearchChange,
  categoryValue,
  categoryOptions,
  onCategoryChange,
  typeValue,
  typeOptions,
  onTypeChange,
  sizeValue,
  sizeOptions,
  onSizeChange,
  colorValue,
  colorOptions,
  onColorChange,
  statusValue,
  statusOptions,
  onStatusChange,
  statusLabel,
  catalogActiveValue,
  catalogActiveOptions,
  onCatalogActiveChange,
  orderStatusValue,
  orderStatusOptions,
  onOrderStatusChange,
  onClear,
  disabledClear,
  endActions,
}) => (
  <div className="card p-1.5 mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px]">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 flex-1">
      <span className="text-gray-500 font-medium shrink-0">Filters</span>
      {onSearchChange ? (
        <label className="flex items-center gap-1 shrink-0 min-w-[10rem] flex-1 max-w-[14rem]">
          <Search size={14} className="text-gray-400 shrink-0" aria-hidden />
          <input
            type="search"
            className="flex-1 min-w-0 outline-none text-[11px] bg-transparent"
            placeholder={searchPlaceholder || 'Search name or code…'}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </label>
      ) : null}
      {categoryOptions?.length ? (
        <label className="flex items-center gap-0.5 shrink-0 min-w-0">
          <span className="text-gray-500 shrink-0">Category</span>
          <select
            className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px] max-w-[9rem]"
            value={categoryValue}
            onChange={(e) => onCategoryChange(e.target.value)}
          >
            {categoryOptions.map((o) => (
              <option key={o.value || '_'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {typeOptions?.length ? (
        <label className="flex items-center gap-0.5 shrink-0">
          <span className="text-gray-500">Type</span>
          <select
            className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px] max-w-[7rem]"
            value={typeValue}
            onChange={(e) => onTypeChange(e.target.value)}
          >
            {typeOptions.map((o) => (
              <option key={o.value || '_'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {sizeOptions?.length ? (
        <label className="flex items-center gap-0.5 shrink-0 min-w-0">
          <span className="text-gray-500 shrink-0">Size</span>
          <select
            className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px] max-w-[8rem]"
            value={sizeValue}
            onChange={(e) => onSizeChange(e.target.value)}
          >
            {sizeOptions.map((o) => (
              <option key={o.value || '_'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {colorOptions?.length ? (
        <label className="flex items-center gap-0.5 shrink-0 min-w-0">
          <span className="text-gray-500 shrink-0">Color</span>
          <select
            className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px] max-w-[9rem]"
            value={colorValue}
            onChange={(e) => onColorChange(e.target.value)}
          >
            {colorOptions.map((o) => (
              <option key={o.value || '_'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {catalogActiveOptions?.length ? (
        <label className="flex items-center gap-0.5 shrink-0">
          <span className="text-gray-500">Catalog</span>
          <select
            className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px] max-w-[8.5rem]"
            value={catalogActiveValue}
            onChange={(e) => onCatalogActiveChange(e.target.value)}
          >
            {catalogActiveOptions.map((o) => (
              <option key={o.value || '_'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {statusOptions?.length ? (
        <label className="flex items-center gap-0.5 shrink-0">
          <span className="text-gray-500">{statusLabel || 'Status'}</span>
          <select
            className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px] max-w-[8.5rem]"
            value={statusValue}
            onChange={(e) => onStatusChange(e.target.value)}
          >
            {statusOptions.map((o) => (
              <option key={o.value || '_'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {orderStatusOptions?.length ? (
        <label className="flex items-center gap-0.5 shrink-0 min-w-0">
          <span className="text-gray-500 shrink-0">Order</span>
          <select
            className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px] max-w-[9rem]"
            value={orderStatusValue}
            onChange={(e) => onOrderStatusChange(e.target.value)}
          >
            {orderStatusOptions.map((o) => (
              <option key={o.value || '_'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
    <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={FilterX}
        className="h-7 px-1.5 text-[11px]"
        onClick={onClear}
        disabled={disabledClear}
      >
        Clear
      </Button>
      {endActions}
    </div>
  </div>
);

CompactCatalogFilters.propTypes = {
  searchValue: PropTypes.string,
  searchPlaceholder: PropTypes.string,
  onSearchChange: PropTypes.func,
  categoryValue: PropTypes.string,
  categoryOptions: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })),
  onCategoryChange: PropTypes.func,
  typeValue: PropTypes.string,
  typeOptions: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })),
  onTypeChange: PropTypes.func,
  sizeValue: PropTypes.string,
  sizeOptions: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })),
  onSizeChange: PropTypes.func,
  colorValue: PropTypes.string,
  colorOptions: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })),
  onColorChange: PropTypes.func,
  statusValue: PropTypes.string,
  statusOptions: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })),
  onStatusChange: PropTypes.func,
  statusLabel: PropTypes.string,
  catalogActiveValue: PropTypes.string,
  catalogActiveOptions: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })),
  onCatalogActiveChange: PropTypes.func,
  orderStatusValue: PropTypes.string,
  orderStatusOptions: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })),
  onOrderStatusChange: PropTypes.func,
  onClear: PropTypes.func.isRequired,
  disabledClear: PropTypes.bool,
  endActions: PropTypes.node,
};

CompactCatalogFilters.defaultProps = {
  searchValue: '',
  searchPlaceholder: 'Search name or code…',
  onSearchChange: null,
  categoryValue: '',
  categoryOptions: null,
  onCategoryChange: () => {},
  typeValue: '',
  typeOptions: null,
  onTypeChange: () => {},
  sizeValue: '',
  sizeOptions: null,
  onSizeChange: () => {},
  colorValue: '',
  colorOptions: null,
  onColorChange: () => {},
  statusValue: '',
  statusOptions: null,
  onStatusChange: () => {},
  statusLabel: 'Status',
  catalogActiveValue: 'active',
  catalogActiveOptions: null,
  onCatalogActiveChange: () => {},
  orderStatusValue: '',
  orderStatusOptions: null,
  onOrderStatusChange: () => {},
  disabledClear: false,
  endActions: null,
};

export default CompactCatalogFilters;
