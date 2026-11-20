import {
  ACTIONS,
  ALL_PERMISSION_MODULES,
  MODULE_LABELS,
  MODULES,
  SENSITIVE_PERMISSION_TARGETS,
  isSensitivePermissionKey,
  permissionScreenGroups,
} from '@wrs/shared';
import { ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';

import TableHeaderLabel from '../ui/TableHeaderLabel.jsx';

/** Every permission key the editor tracks (modules, sidebar screens, sensitive data). */
export const MODULE_LIST = [...ALL_PERMISSION_MODULES];

// Only actions the API / UI actually enforce are shown. Cancel, Refund, Override Gap and
// Apply Discount exist in @wrs/shared but nothing checks them yet, so ticking them
// would mislead admins. Stored values for hidden actions are left untouched.
const UNENFORCED_ACTIONS = new Set([
  ACTIONS.CANCEL,
  ACTIONS.REFUND,
  ACTIONS.OVERRIDE_GAP,
  ACTIONS.APPLY_DISCOUNT,
]);
export const ACTION_LIST = Object.values(ACTIONS).filter((a) => !UNENFORCED_ACTIONS.has(a));

const ACTION_LABELS = {
  [ACTIONS.VIEW]: 'View',
  [ACTIONS.CREATE]: 'Add',
  [ACTIONS.EDIT]: 'Edit',
  [ACTIONS.DELETE]: 'Delete',
  [ACTIONS.EXPORT]: 'Export',
  [ACTIONS.PRINT]: 'Print',
  [ACTIONS.APPROVE]: 'Approve',
};

export const titleizePermission = (s) =>
  String(s || '')
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ');

/** Effective value: sensitive keys count as allowed until explicitly turned off. */
function cellValue(grid, m, a) {
  const row = grid?.[m];
  if (isSensitivePermissionKey(m) && (!row || !(a in row))) return true;
  return !!row?.[a];
}

/** Deep-equal on the simple `{ module: { action: boolean } }` shape. */
export function permissionMatrixEqual(a, b) {
  if (!a || !b) return a === b;
  for (const m of MODULE_LIST) {
    for (const act of ACTION_LIST) {
      if (cellValue(a, m, act) !== cellValue(b, m, act)) return false;
    }
  }
  return true;
}

const SCREEN_GROUPS = permissionScreenGroups();
const BACKEND_MODULES = Object.values(MODULES);

function Checkbox({ checked, disabled, onChange, label }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      readOnly={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="rounded border-gray-300 text-brand focus:ring-brand cursor-pointer disabled:cursor-not-allowed"
      aria-label={label}
    />
  );
}

Checkbox.propTypes = {
  checked: PropTypes.bool.isRequired,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  label: PropTypes.string.isRequired,
};

/**
 * Permission editor shared by the role editor (Settings → Roles & Permissions)
 * and the per-user editor (Master → Users). Laid out like the sidebar: each
 * section lists its screens with only the actions that screen supports, then a
 * "Sensitive data" section and an advanced backend-module grid.
 *
 * Purely presentational: the caller owns the grid and receives the next one via `onChange`.
 */
const PermissionMatrix = ({ grid, onChange, editable = true, forceAllOn = false, loading = false }) => {
  const [openGroups, setOpenGroups] = useState(() => new Set([SCREEN_GROUPS[0]?.group]));
  const [showAdvanced, setShowAdvanced] = useState(false);

  const value = (m, a) => forceAllOn || cellValue(grid, m, a);

  /**
   * Apply several { key, action, value } changes at once. Granting a screen action
   * also grants it on the screen's backend module so its API calls are allowed;
   * removing View on a screen removes its other actions too.
   */
  const apply = (changes) => {
    if (!editable) return;
    const next = { ...(grid || {}) };
    const touch = (m) => {
      next[m] = { ...(next[m] || {}) };
      return next[m];
    };
    for (const { key, action, on, parent } of changes) {
      const row = touch(key);
      row[action] = on;
      if (action === ACTIONS.VIEW && !on) {
        for (const a of ACTION_LIST) row[a] = false;
      }
      if (on && action !== ACTIONS.VIEW) row[ACTIONS.VIEW] = true;
      if (on && parent) {
        const p = touch(parent);
        p[action] = true;
        p[ACTIONS.VIEW] = true;
      }
    }
    onChange(next);
  };

  const setScreen = (screen, action, on) =>
    apply([{ key: screen.key, action, on, parent: screen.parent }]);

  const setGroup = (group, on) =>
    apply(
      group.screens.flatMap((screen) =>
        screen.actions.map((action) => ({ key: screen.key, action, on, parent: screen.parent }))
      )
    );

  const setAll = (on) =>
    apply(
      SCREEN_GROUPS.flatMap((group) =>
        group.screens.flatMap((screen) =>
          screen.actions.map((action) => ({ key: screen.key, action, on, parent: screen.parent }))
        )
      )
    );

  const toggleOpen = (name) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const groupStats = useMemo(
    () =>
      Object.fromEntries(
        SCREEN_GROUPS.map((group) => [
          group.group,
          group.screens.filter((s) => forceAllOn || cellValue(grid, s.key, ACTIONS.VIEW)).length,
        ])
      ),
    [grid, forceAllOn]
  );

  const columnActions = ACTION_LIST;

  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <p className="text-gray-600">
          Tick <b>View</b> to show a screen in the sidebar. Other boxes allow adding, editing,
          deleting, exporting and printing on that screen.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="text-brand hover:underline"
            onClick={() =>
              setOpenGroups((prev) =>
                prev.size === SCREEN_GROUPS.length
                  ? new Set()
                  : new Set(SCREEN_GROUPS.map((g) => g.group))
              )
            }
          >
            {openGroups.size === SCREEN_GROUPS.length ? 'Collapse all' : 'Expand all'}
          </button>
          {editable ? (
            <>
              <button type="button" className="text-brand hover:underline" onClick={() => setAll(true)}>
                Full access
              </button>
              <button
                type="button"
                className="text-gray-600 hover:underline"
                onClick={() => setAll(false)}
              >
                Remove all
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="divide-y divide-gray-100">
        {SCREEN_GROUPS.map((group) => {
          const isOpen = openGroups.has(group.group);
          const allowed = groupStats[group.group] || 0;
          return (
            <section key={group.group}>
              <div className="flex items-center justify-between gap-2 bg-gray-50 px-3 py-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 font-semibold text-gray-900"
                  onClick={() => toggleOpen(group.group)}
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {group.group}
                  <span className="font-normal text-gray-500">
                    · {allowed}/{group.screens.length} screens
                  </span>
                </button>
                {editable ? (
                  <div className="flex gap-2 text-[11px]">
                    <button
                      type="button"
                      className="text-brand hover:underline"
                      onClick={() => setGroup(group, true)}
                    >
                      Allow all
                    </button>
                    <button
                      type="button"
                      className="text-gray-600 hover:underline"
                      onClick={() => setGroup(group, false)}
                    >
                      None
                    </button>
                  </div>
                ) : null}
              </div>
              {isOpen ? (
                <div className="overflow-x-auto">
                  <table className="table min-w-max text-xs">
                    <thead>
                      <tr>
                        <th className="text-left w-64">
                          <TableHeaderLabel>Screen</TableHeaderLabel>
                        </th>
                        {columnActions.map((a) => (
                          <th key={a} className="text-center w-16">
                            <TableHeaderLabel align="center">{ACTION_LABELS[a] || a}</TableHeaderLabel>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.screens.map((screen) => (
                        <tr key={screen.key}>
                          <td className="font-medium text-gray-800">{screen.label}</td>
                          {columnActions.map((a) => (
                            <td key={a} className="text-center">
                              {screen.actions.includes(a) ? (
                                <Checkbox
                                  checked={value(screen.key, a)}
                                  disabled={!editable}
                                  onChange={(on) => setScreen(screen, a, on)}
                                  label={`${group.group} ${screen.label} ${a}`}
                                />
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          );
        })}

        <section>
          <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-2 font-semibold text-gray-900">
            <ShieldAlert size={14} className="text-red-600" aria-hidden />
            Sensitive data
            <span className="font-normal text-gray-500">· untick to hide it from this role/user</span>
          </div>
          <table className="table text-xs">
            <tbody>
              {SENSITIVE_PERMISSION_TARGETS.map((target) => (
                <tr key={target.key}>
                  <td className="font-medium text-gray-800">{target.label}</td>
                  <td className="text-center w-24">
                    <span className="inline-flex items-center gap-1.5">
                      <Checkbox
                        checked={value(target.key, ACTIONS.VIEW)}
                        disabled={!editable}
                        onChange={(on) => apply([{ key: target.key, action: ACTIONS.VIEW, on }])}
                        label={`Can see ${target.label}`}
                      />
                      <span className="text-gray-600">Can see</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <button
            type="button"
            className="flex w-full items-center gap-1.5 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-700"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Advanced: backend modules
            <span className="font-normal text-gray-500">
              · data access used behind several screens (filled automatically from the screens above)
            </span>
          </button>
          {showAdvanced ? (
            <div className="overflow-x-auto">
              <table className="table min-w-max text-xs">
                <thead>
                  <tr>
                    <th className="text-left w-56">
                      <TableHeaderLabel>Module</TableHeaderLabel>
                    </th>
                    {ACTION_LIST.map((a) => (
                      <th key={a} className="text-center w-16">
                        <TableHeaderLabel align="center">{ACTION_LABELS[a] || a}</TableHeaderLabel>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {BACKEND_MODULES.map((m) => (
                    <tr key={m}>
                      <td className="font-medium text-gray-800">
                        {MODULE_LABELS[m] || titleizePermission(m)}
                      </td>
                      {ACTION_LIST.map((a) => (
                        <td key={a} className="text-center">
                          <Checkbox
                            checked={value(m, a)}
                            disabled={!editable}
                            onChange={(on) => apply([{ key: m, action: a, on }])}
                            label={`${m} ${a}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
      {loading ? <div className="p-3 text-xs text-gray-500">Loading…</div> : null}
    </div>
  );
};

PermissionMatrix.propTypes = {
  /** `{ [key]: { [action]: boolean } }` */
  grid: PropTypes.object,
  /** Called with the next full matrix. */
  onChange: PropTypes.func.isRequired,
  editable: PropTypes.bool,
  /** Render every cell ticked and read-only (super admin / shop admin). */
  forceAllOn: PropTypes.bool,
  loading: PropTypes.bool,
};

export default PermissionMatrix;
