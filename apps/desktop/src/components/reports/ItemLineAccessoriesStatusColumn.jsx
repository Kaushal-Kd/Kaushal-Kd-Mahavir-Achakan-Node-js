import { ClipboardList } from 'lucide-react';
import PropTypes from 'prop-types';

import { summarizeLineAccessories } from '../../lib/lineAccessoryChecklistSummary.js';
import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';

/**
 * @param {{ onOpenChecklist: (row: object) => void }} opts
 */
export function buildItemLineAccessoriesStatusColumn({ onOpenChecklist }) {
  return {
    key: 'line_accessories_status',
    columnPickerLabel: 'Accessory status',
    header: 'Accessories',
    className: 'text-xs whitespace-nowrap',
    render: (row) => (
      <ItemLineAccessoriesStatusCell row={row} onOpenChecklist={onOpenChecklist} />
    ),
  };
}

function ItemLineAccessoriesStatusCell({ row, onOpenChecklist }) {
  const summary = summarizeLineAccessories(row?.line_accessories);
  const canOpen = summary.hasChecklist;

  return (
    <div
      className="inline-flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      {summary.hasChecklist ? (
        <Badge tone={summary.tone} className="whitespace-nowrap shrink-0">
          {summary.label}
        </Badge>
      ) : (
        <span className="text-gray-400">—</span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={ClipboardList}
        iconOnly
        className="text-brand hover:bg-brand-light/60"
        title={canOpen ? 'Accessory checklist' : 'No accessories on this line'}
        aria-label={canOpen ? 'Accessory checklist' : 'No accessories on this line'}
        disabled={!canOpen}
        onClick={() => {
          if (!canOpen) return;
          onOpenChecklist(row);
        }}
      />
    </div>
  );
}

ItemLineAccessoriesStatusCell.propTypes = {
  row: PropTypes.object.isRequired,
  onOpenChecklist: PropTypes.func.isRequired,
};
