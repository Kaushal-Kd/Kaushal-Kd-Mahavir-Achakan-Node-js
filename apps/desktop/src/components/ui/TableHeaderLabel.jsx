import clsx from 'clsx';
import PropTypes from 'prop-types';

function alignItemsClass(align) {
  if (align === 'center') return 'items-center';
  if (align === 'right') return 'items-end';
  return 'items-start';
}

/**
 * Renders a table header with each word on its own line (e.g. "Reference Name" → Reference / Name).
 * @param {string} text
 */
export function splitHeaderWords(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/).filter(Boolean);
}

/**
 * @param {import('react').ReactNode} header
 * @param {{ align?: string, headerWrap?: boolean }} [column]
 */
export function renderTableHeader(header, column = {}) {
  if (column.headerWrap === false) return header;
  if (typeof header !== 'string' || !header.trim()) return header;
  return <TableHeaderLabel align={column.align}>{header}</TableHeaderLabel>;
}

const TableHeaderLabel = ({ children, align, nowrap = false, className }) => {
  if (nowrap || typeof children !== 'string') {
    return <span className={className}>{children}</span>;
  }

  const words = splitHeaderWords(children);
  if (words.length <= 1) {
    return <span className={className}>{children}</span>;
  }

  return (
    <span
      className={clsx(
        'inline-flex flex-col gap-0 leading-tight',
        alignItemsClass(align),
        className
      )}
    >
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="block">
          {word}
        </span>
      ))}
    </span>
  );
};

TableHeaderLabel.propTypes = {
  children: PropTypes.node,
  align: PropTypes.oneOf(['left', 'center', 'right']),
  nowrap: PropTypes.bool,
  className: PropTypes.string,
};

TableHeaderLabel.defaultProps = {
  children: null,
  align: 'left',
  nowrap: false,
  className: undefined,
};

export default TableHeaderLabel;
