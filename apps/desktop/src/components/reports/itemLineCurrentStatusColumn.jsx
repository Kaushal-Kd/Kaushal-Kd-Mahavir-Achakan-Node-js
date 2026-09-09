import ItemLineCurrentStatusCell from './ItemLineCurrentStatusCell.jsx';

/** Locked column for Item to Collect / Prepare lists. */
export function buildItemCurrentStatusColumn() {
  return {
    key: 'item_status',
    locked: true,
    columnPickerLabel: 'Current status',
    header: 'Current status',
    className: 'text-xs whitespace-nowrap',
    render: (r) => <ItemLineCurrentStatusCell row={r} />,
  };
}
