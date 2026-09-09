import { ORDER_STATUS_LABELS } from '@wrs/shared';
import PropTypes from 'prop-types';
import { FilterX } from 'lucide-react';

import Button from '../ui/Button.jsx';
import DatePicker from '../ui/DatePicker.jsx';

const DATE_FIELD_OPTS = [
  { value: 'booking_date', label: 'Book' },
  { value: 'pickup_date', label: 'Pickup' },
  { value: 'return_date', label: 'Return' },
];
const SORT_BY_OPTS = [
  { value: 'created_at', label: 'Created' },
  { value: 'booking_date', label: 'Book' },
  { value: 'pickup_date', label: 'Pickup' },
  { value: 'return_date', label: 'Return' },
];

const DELIVERY_SORT_OPTS = [
  { value: 'pickup_date', label: 'Delivery date' },
  { value: 'return_date', label: 'Return date' },
  { value: 'order_number', label: 'Order no.' },
  { value: 'booking_date', label: 'Book date' },
  { value: 'created_at', label: 'Created' },
];

const RETURN_SORT_OPTS = [
  { value: 'return_date', label: 'Return date' },
  { value: 'pickup_date', label: 'Delivery date' },
  { value: 'order_number', label: 'Order no.' },
  { value: 'booking_date', label: 'Book date' },
  { value: 'created_at', label: 'Created' },
];

const statusEntries = () =>
  Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label }));

/**
 * Compact filter row for order lists (single wrapped line, wraps on narrow screens).
 */
const CompactOrderFilters = ({
  variant,
  dateField,
  onDateFieldChange,
  sortBy,
  onSortByChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  status,
  onStatusChange,
  statusOptions,
  pickupFrom,
  pickupTo,
  onPickupFromChange,
  onPickupToChange,
  returnFrom,
  returnTo,
  onReturnFromChange,
  onReturnToChange,
  onClear,
  disabledClear,
}) => {
  if (variant === 'delivery') {
    return (
      <div className="card p-1.5 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="text-gray-500 font-medium shrink-0">Refine</span>
        <label className="flex items-center gap-0.5 shrink-0">
          <span className="text-gray-500">Sort by</span>
          <select
            className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px]"
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value)}
          >
            {DELIVERY_SORT_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-0.5 shrink-0">
          <span className="text-gray-500">Pickup from</span>
          <DatePicker
            className="w-[9.5rem]"
            inputClassName="h-7 text-[11px] px-1 py-0.5"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <span className="text-gray-500">to</span>
          <DatePicker
            className="w-[9.5rem]"
            inputClassName="h-7 text-[11px] px-1 py-0.5"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-0.5 shrink-0 min-w-0">
          <span className="text-gray-500 shrink-0">Status</span>
          <select
            className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px] max-w-[11rem]"
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
          >
            {(statusOptions || []).map((o) => (
              <option key={o.value || '_'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
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
      </div>
    );
  }

  if (variant === 'return') {
    return (
      <div className="card p-1.5 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="text-gray-500 font-medium shrink-0">Refine</span>
        <label className="flex items-center gap-0.5 shrink-0">
          <span className="text-gray-500">Sort by</span>
          <select
            className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px]"
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value)}
          >
            {RETURN_SORT_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-0.5 shrink-0">
          <span className="text-gray-500">Return from</span>
          <DatePicker
            className="w-[9.5rem]"
            inputClassName="h-7 text-[11px] px-1 py-0.5"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <span className="text-gray-500">to</span>
          <DatePicker
            className="w-[9.5rem]"
            inputClassName="h-7 text-[11px] px-1 py-0.5"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-0.5 shrink-0 min-w-0">
          <span className="text-gray-500 shrink-0">Status</span>
          <select
            className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px] max-w-[11rem]"
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
          >
            {(statusOptions || []).map((o) => (
              <option key={o.value || '_'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
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
      </div>
    );
  }

  return (
    <div className="card p-1.5 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
      <span className="text-gray-500 font-medium shrink-0">Filters</span>
      <label className="flex items-center gap-0.5 shrink-0">
        <span className="text-gray-500">Date by</span>
        <select
          className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px]"
          value={dateField}
          onChange={(e) => onDateFieldChange(e.target.value)}
        >
          {DATE_FIELD_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-0.5 shrink-0">
        <span className="text-gray-500">Sort by</span>
        <select
          className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px]"
          value={sortBy}
          onChange={(e) => onSortByChange(e.target.value)}
        >
          {SORT_BY_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-0.5 shrink-0">
        <span className="text-gray-500">From</span>
        <DatePicker
          className="w-[9.5rem]"
          inputClassName="h-7 text-[11px] px-1 py-0.5"
          value={dateFrom}
          onChange={(e) => onDateFromChange(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <span className="text-gray-500">To</span>
        <DatePicker
          className="w-[9.5rem]"
          inputClassName="h-7 text-[11px] px-1 py-0.5"
          value={dateTo}
          onChange={(e) => onDateToChange(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-0.5 shrink-0 min-w-0">
        <span className="text-gray-500 shrink-0">Status</span>
        <select
          className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px] max-w-[9.5rem]"
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          <option value="">All</option>
          {(statusOptions || statusEntries()).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
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
    </div>
  );
};

CompactOrderFilters.propTypes = {
  variant: PropTypes.oneOf(['booking', 'delivery', 'return']).isRequired,
  dateField: PropTypes.string,
  onDateFieldChange: PropTypes.func,
  sortBy: PropTypes.string,
  onSortByChange: PropTypes.func,
  dateFrom: PropTypes.string,
  dateTo: PropTypes.string,
  onDateFromChange: PropTypes.func.isRequired,
  onDateToChange: PropTypes.func.isRequired,
  status: PropTypes.string,
  onStatusChange: PropTypes.func.isRequired,
  statusOptions: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })),
  pickupFrom: PropTypes.string,
  pickupTo: PropTypes.string,
  onPickupFromChange: PropTypes.func,
  onPickupToChange: PropTypes.func,
  returnFrom: PropTypes.string,
  returnTo: PropTypes.string,
  onReturnFromChange: PropTypes.func,
  onReturnToChange: PropTypes.func,
  onClear: PropTypes.func.isRequired,
  disabledClear: PropTypes.bool,
};

CompactOrderFilters.defaultProps = {
  dateField: 'booking_date',
  onDateFieldChange: undefined,
  sortBy: 'pickup_date',
  onSortByChange: undefined,
  dateFrom: '',
  dateTo: '',
  status: '',
  statusOptions: undefined,
  pickupFrom: '',
  pickupTo: '',
  onPickupFromChange: undefined,
  onPickupToChange: undefined,
  returnFrom: '',
  returnTo: '',
  onReturnFromChange: undefined,
  onReturnToChange: undefined,
  disabledClear: false,
};

export default CompactOrderFilters;
