/** Pin permanent-delete intent to the row the user actually reviewed. */
export function catalogDeleteModeForRow(row) {
  return [false, 0, '0'].includes(row?.is_active) ? 'permanent' : 'deactivate';
}
