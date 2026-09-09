/** @param {object} row */
export function itemStageSalesPersonLabel(row) {
  return String(row?.sales_person_name ?? '').trim() || 'Unassigned';
}

export function buildItemStageSalesmanColumn() {
  return {
    key: 'sales_person_name',
    columnPickerLabel: 'Salesman',
    header: 'Salesman',
    className: 'text-xs whitespace-nowrap',
    render: (r) => (
      <span className="text-gray-900 font-medium">{itemStageSalesPersonLabel(r)}</span>
    ),
  };
}
