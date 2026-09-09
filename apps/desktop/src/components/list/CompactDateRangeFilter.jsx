import PropTypes from 'prop-types';
import { FilterX } from 'lucide-react';

import Button from '../ui/Button.jsx';
import DatePicker from '../ui/DatePicker.jsx';

const CompactDateRangeFilter = ({ label, from, to, onFromChange, onToChange, onClear, disabledClear }) => (
  <div className="card p-1.5 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
    <span className="text-gray-500 font-medium shrink-0">{label}</span>
    <div className="flex items-center gap-0.5 shrink-0">
      <span className="text-gray-500">From</span>
      <DatePicker
        className="w-[9.5rem]"
        inputClassName="h-7 text-[11px] px-1 py-0.5"
        value={from}
        onChange={(e) => onFromChange(e.target.value)}
      />
    </div>
    <div className="flex items-center gap-0.5 shrink-0">
      <span className="text-gray-500">To</span>
      <DatePicker
        className="w-[9.5rem]"
        inputClassName="h-7 text-[11px] px-1 py-0.5"
        value={to}
        onChange={(e) => onToChange(e.target.value)}
      />
    </div>
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

CompactDateRangeFilter.propTypes = {
  label: PropTypes.string.isRequired,
  from: PropTypes.string.isRequired,
  to: PropTypes.string.isRequired,
  onFromChange: PropTypes.func.isRequired,
  onToChange: PropTypes.func.isRequired,
  onClear: PropTypes.func.isRequired,
  disabledClear: PropTypes.bool,
};

CompactDateRangeFilter.defaultProps = {
  disabledClear: false,
};

export default CompactDateRangeFilter;
