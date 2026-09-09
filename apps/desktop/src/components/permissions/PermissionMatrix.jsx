import {
  ACTIONS,
  MENU_PERMISSION_TARGETS,
  MODULE_LABELS,
  MODULES,
} from '@wrs/shared';
import PropTypes from 'prop-types';

import TableHeaderLabel from '../ui/TableHeaderLabel.jsx';

export const MODULE_LIST = [
  ...Object.values(MODULES),
  ...MENU_PERMISSION_TARGETS.map((target) => target.key),
];
const MENU_LABELS = Object.fromEntries(
  MENU_PERMISSION_TARGETS.map((target) => [target.key, target.label])
);
export const ACTION_LIST = Object.values(ACTIONS);

export const titleizePermission = (s) =>
  String(s || '')
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ');

/** Deep-equal on the simple `{ module: { action: bool } }` shape. */
export function permissionMatrixEqual(a, b) {
  if (!a || !b) return a === b;
  for (const m of MODULE_LIST) {
    for (const act of ACTION_LIST) {
      if (!!a?.[m]?.[act] !== !!b?.[m]?.[act]) return false;
    }
  }
  return true;
}

/**
 * The module × action permission grid, shared by the role editor
 * (Settings → Permissions) and the per-user editor (Master → Users).
 *
 * Purely presentational: the caller owns the grid state and passes `onChange`
 * with the next matrix.
 */
const PermissionMatrix = ({ grid, onChange, editable = true, forceAllOn = false, loading = false }) => {
  const setCell = (m, a, value) => {
    if (!editable) return;
    onChange({ ...grid, [m]: { ...(grid?.[m] || {}), [a]: value } });
  };

  const toggleRow = (m, value) => {
    if (!editable) return;
    const next = { ...(grid?.[m] || {}) };
    for (const a of ACTION_LIST) next[a] = value;
    onChange({ ...grid, [m]: next });
  };

  const toggleColumn = (a, value) => {
    if (!editable) return;
    const out = { ...grid };
    for (const m of MODULE_LIST) out[m] = { ...(out[m] || {}), [a]: value };
    onChange(out);
  };

  const allOn = (m) => ACTION_LIST.every((a) => !!grid?.[m]?.[a]);
  const allOff = (m) => ACTION_LIST.every((a) => !grid?.[m]?.[a]);

  return (
    <div className="table-wrap max-h-[min(65vh,42rem)] overflow-auto">
      <table className="table min-w-max text-xs">
        <thead className="sticky top-0 z-20 bg-surface shadow-sm">
          <tr>
            <th className="sticky left-0 z-30 bg-surface text-left">
              <TableHeaderLabel>Module</TableHeaderLabel>
            </th>
            {ACTION_LIST.map((a) => (
              <th key={a} className="text-center">
                <div className="flex flex-col items-center gap-0.5">
                  <TableHeaderLabel align="center">{titleizePermission(a)}</TableHeaderLabel>
                  {editable ? (
                    <div className="flex gap-1 text-[10px] text-gray-500">
                      <button
                        type="button"
                        className="hover:text-brand"
                        onClick={() => toggleColumn(a, true)}
                      >
                        all
                      </button>
                      <span>·</span>
                      <button
                        type="button"
                        className="hover:text-brand"
                        onClick={() => toggleColumn(a, false)}
                      >
                        none
                      </button>
                    </div>
                  ) : null}
                </div>
              </th>
            ))}
            <th className="text-right w-24">
              <TableHeaderLabel align="right">Row</TableHeaderLabel>
            </th>
          </tr>
        </thead>
        <tbody>
          {MODULE_LIST.map((m) => {
            const rowAll = allOn(m);
            const rowNone = allOff(m);
            return (
              <tr key={m}>
                <td className="sticky left-0 z-10 bg-surface font-medium">
                  {MENU_LABELS[m] || MODULE_LABELS[m] || titleizePermission(m)}
                </td>
                {ACTION_LIST.map((a) => {
                  const allowed = forceAllOn || !!grid?.[m]?.[a];
                  return (
                    <td key={a} className="text-center">
                      <input
                        type="checkbox"
                        checked={allowed}
                        readOnly={!editable}
                        disabled={!editable}
                        onChange={(e) => setCell(m, a, e.target.checked)}
                        className="rounded border-gray-300 text-brand focus:ring-brand cursor-pointer disabled:cursor-not-allowed"
                        aria-label={`${m} ${a}`}
                      />
                    </td>
                  );
                })}
                <td className="text-right">
                  {editable ? (
                    <div className="flex gap-1 justify-end text-[11px]">
                      <button
                        type="button"
                        className={`px-1.5 py-0.5 rounded border ${
                          rowAll
                            ? 'bg-brand text-white border-brand'
                            : 'border-gray-300 text-gray-600 hover:border-brand hover:text-brand'
                        }`}
                        onClick={() => toggleRow(m, true)}
                      >
                        all
                      </button>
                      <button
                        type="button"
                        className={`px-1.5 py-0.5 rounded border ${
                          rowNone
                            ? 'bg-gray-200 text-gray-700 border-gray-300'
                            : 'border-gray-300 text-gray-600 hover:border-brand hover:text-brand'
                        }`}
                        onClick={() => toggleRow(m, false)}
                      >
                        none
                      </button>
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {loading ? <div className="p-3 text-xs text-gray-500">Loading…</div> : null}
    </div>
  );
};

PermissionMatrix.propTypes = {
  /** `{ [module]: { [action]: boolean } }` */
  grid: PropTypes.object,
  /** Called with the next full matrix. */
  onChange: PropTypes.func.isRequired,
  editable: PropTypes.bool,
  /** Render every cell ticked and read-only (super admin). */
  forceAllOn: PropTypes.bool,
  loading: PropTypes.bool,
};

export default PermissionMatrix;
