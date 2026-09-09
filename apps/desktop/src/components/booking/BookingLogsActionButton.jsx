import { ScrollText } from 'lucide-react';
import PropTypes from 'prop-types';

const BookingLogsActionButton = ({ orderId, editCount, onOpenLogs }) => (
  <button
    type="button"
    className="inline-flex items-center justify-center gap-0.5 rounded-md border border-brand/40 bg-brand-light/50 px-1.5 py-1 min-w-[2.25rem] text-brand hover:bg-brand-light hover:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
    title={`View logs (${editCount} edit${editCount === 1 ? '' : 's'})`}
    aria-label={`View booking logs, ${editCount} edits`}
    data-order-id={orderId || undefined}
    onClick={(event) => {
      event.stopPropagation();
      onOpenLogs?.();
    }}
  >
    <ScrollText size={14} aria-hidden className="shrink-0" />
    <span className="text-[10px] font-semibold tabular-nums leading-none min-w-[0.65rem] text-center">
      {editCount}
    </span>
  </button>
);

BookingLogsActionButton.propTypes = {
  orderId: PropTypes.string,
  editCount: PropTypes.number,
  onOpenLogs: PropTypes.func,
};

BookingLogsActionButton.defaultProps = {
  orderId: null,
  editCount: 0,
  onOpenLogs: undefined,
};

export default BookingLogsActionButton;
