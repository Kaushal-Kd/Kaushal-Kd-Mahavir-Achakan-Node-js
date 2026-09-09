import { formatFieldPath } from '@wrs/shared';
import PropTypes from 'prop-types';

import { displayChangeValue } from '../../lib/snapshotDiffDisplay.js';

/** @param {string} path */
function looksLikeRawPath(path) {
  return /^(items|accessories|order|customer)\[/.test(String(path || ''));
}

/**
 * Human-readable field label for a flat audit row or snapshot change row.
 * @param {{ label?: string, path?: string, itemLabel?: string }} row
 */
export function formatAuditFieldLabel(row) {
  const label = String(row?.label || '').trim();
  const path = String(row?.path || '').trim();
  const itemLabel = String(row?.itemLabel || '').trim();

  let primary = label;
  if (!primary && path) primary = formatFieldPath(path);
  if (!primary) primary = '—';

  if (itemLabel && looksLikeRawPath(path) && !primary.includes(itemLabel)) {
    return `${itemLabel} · ${primary}`;
  }
  return primary;
}

export function auditChangeKindBadgeClass(kind) {
  if (kind === 'added') return 'bg-green-50 text-green-800 border-green-200';
  if (kind === 'removed') return 'bg-red-50 text-red-800 border-red-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

export function auditChangeKindLabel(kind, dense = false) {
  if (dense) {
    if (kind === 'added') return '+';
    if (kind === 'removed') return '−';
    return '~';
  }
  if (kind === 'added') return 'Added';
  if (kind === 'removed') return 'Removed';
  return 'Changed';
}

export function AuditChangeKindBadge({ kind, dense = false }) {
  if (!kind) {
    return <span className="text-gray-400">—</span>;
  }
  return (
    <span
      className={`inline-flex items-center justify-center rounded border font-bold leading-none ${auditChangeKindBadgeClass(kind)} ${
        dense ? 'w-4 h-4 text-[9px]' : 'text-[9px] px-1 py-0.5'
      }`}
      title={auditChangeKindLabel(kind, false)}
    >
      {auditChangeKindLabel(kind, dense)}
    </span>
  );
}

AuditChangeKindBadge.propTypes = {
  kind: PropTypes.string,
  dense: PropTypes.bool,
};

export function AuditChangeValueCell({ value, dense = false, className = '' }) {
  const text = displayChangeValue(value, { maxLength: 0 });
  if (text === '—') {
    return <span className={`text-gray-400 ${className}`.trim()}>—</span>;
  }
  const parts =
    typeof text === 'string' && text.includes('; ')
      ? text.split(/;\s+/).map((p) => p.trim()).filter(Boolean)
      : null;

  if (parts && parts.length > 1) {
    return (
      <ul className={`m-0 list-none space-y-0.5 ${dense ? 'text-[10px]' : 'text-xs'} ${className}`.trim()}>
        {parts.map((part) => (
          <li key={part} className="break-words leading-snug text-inherit">
            {part}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <span
      className={`block break-words whitespace-pre-wrap leading-snug ${dense ? 'text-[10px]' : 'text-xs'} ${className}`.trim()}
    >
      {text}
    </span>
  );
}

AuditChangeValueCell.propTypes = {
  value: PropTypes.any,
  dense: PropTypes.bool,
  className: PropTypes.string,
};

export function AuditChangeFieldCell({ row, dense = false }) {
  const text = formatAuditFieldLabel(row);
  return (
    <span
      className={`font-medium text-gray-900 break-words leading-snug ${dense ? 'text-[10px]' : 'text-xs'}`}
      title={row?.path || undefined}
    >
      {text}
    </span>
  );
}

AuditChangeFieldCell.propTypes = {
  row: PropTypes.object,
  dense: PropTypes.bool,
};
