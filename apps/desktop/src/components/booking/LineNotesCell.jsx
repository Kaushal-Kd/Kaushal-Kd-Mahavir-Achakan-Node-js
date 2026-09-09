import PropTypes from 'prop-types';

import SmartImage from '../ui/SmartImage.jsx';

/**
 * Table cell for product tailor notes + optional reference image.
 */
export default function LineNotesCell({
  notes,
  noteImage,
  compact,
  className,
  showDashWhenEmpty = true,
}) {
  const emptyClass = compact ? 'px-2 py-1.5' : '';
  const hasContent = LineNotesContent.hasContent({ notes, noteImage });

  if (!hasContent) {
    return (
      <td className={`${emptyClass} ${className || ''}`.trim()}>
        {showDashWhenEmpty ? <span className="text-gray-400 text-[10px]">—</span> : null}
      </td>
    );
  }

  const cellPad = compact ? 'px-2 py-1.5' : '';

  return (
    <td className={`max-w-[9rem] ${cellPad} ${className || 'align-top whitespace-normal'}`.trim()}>
      <LineNotesContent notes={notes} noteImage={noteImage} compact={compact} clampText />
    </td>
  );
}

/** @param {{ notes?: string, noteImage?: string, compact?: boolean, clampText?: boolean }} props */
export function LineNotesContent({ notes, noteImage, compact, clampText }) {
  const text = String(notes ?? '').trim();
  const image = String(noteImage ?? '').trim();

  const textClass = compact
    ? 'text-[10px] font-medium leading-snug text-brand'
    : 'text-[11px] font-medium leading-snug text-brand';
  const thumbClass = compact ? 'w-8 h-8' : 'w-10 h-10';
  const clamp = clampText ? 'line-clamp-2' : '';

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {image ? (
        <SmartImage
          src={image}
          alt="Note reference"
          className={`rounded border border-gray-200 bg-white object-contain ${thumbClass}`}
        />
      ) : null}
      {text ? (
        <p className={`${textClass} ${clamp} whitespace-pre-wrap break-words`} title={text}>
          {text}
        </p>
      ) : null}
    </div>
  );
}

LineNotesContent.hasContent = ({ notes, noteImage }) => {
  const text = String(notes ?? '').trim();
  const image = String(noteImage ?? '').trim();
  return Boolean(text || image);
};

LineNotesCell.propTypes = {
  notes: PropTypes.string,
  noteImage: PropTypes.string,
  compact: PropTypes.bool,
  className: PropTypes.string,
  showDashWhenEmpty: PropTypes.bool,
};

LineNotesContent.propTypes = {
  notes: PropTypes.string,
  noteImage: PropTypes.string,
  compact: PropTypes.bool,
  clampText: PropTypes.bool,
};
