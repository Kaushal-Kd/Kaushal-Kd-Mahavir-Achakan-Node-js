import PropTypes from 'prop-types';

import { LineNotesContent } from '../booking/LineNotesCell.jsx';
import {
  accessoryRemarksPartsFromRow,
  formatItemStageAllNotes,
  formatItemStageProductRemarks,
} from '../../lib/itemStageNotes.js';

function NotesTextBlock({ text, title }) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  return (
    <p className="text-[10px] text-gray-800 whitespace-pre-wrap break-words leading-snug" title={title || t}>
      {t}
    </p>
  );
}

NotesTextBlock.propTypes = {
  text: PropTypes.string,
  title: PropTypes.string,
};

function ItemStageAllNotesContent({ row }) {
  const bill = String(row?.customer_notes ?? '').trim();
  const delivery = String(row?.delivery_notes ?? '').trim();
  const accessories = accessoryRemarksPartsFromRow(row);
  const hasAny = bill || delivery || accessories.length > 0;

  if (!hasAny) {
    return <span className="text-gray-400">—</span>;
  }

  return (
    <div className="min-w-0 max-w-[18rem] space-y-1">
      {bill ? (
        <div>
          <span className="text-[10px] font-semibold text-gray-600">Bill remarks: </span>
          <NotesTextBlock text={bill} />
        </div>
      ) : null}
      {delivery ? (
        <div>
          <span className="text-[10px] font-semibold text-gray-600">Delivery note: </span>
          <NotesTextBlock text={delivery} />
        </div>
      ) : null}
      {accessories.length ? (
        <div className="space-y-0.5">
          <span className="text-[10px] font-semibold text-gray-600">Accessory:</span>
          {accessories.map(({ label, remark }) => (
            <p
              key={`${label}-${remark.slice(0, 24)}`}
              className="text-[10px] text-gray-800 whitespace-pre-wrap break-words leading-snug"
            >
              <span className="font-semibold text-gray-900">{label}: </span>
              {remark}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

ItemStageAllNotesContent.propTypes = {
  row: PropTypes.object.isRequired,
};

function ItemStageProductNotesContent({ row }) {
  const tailor = String(row?.tailor_notes ?? '').trim();
  const image = String(row?.tailor_note_image ?? '').trim();
  const catalog = String(row?.product_catalog_notes ?? '').trim();

  if (!LineNotesContent.hasContent({ notes: tailor, noteImage: image }) && !catalog) {
    return <span className="text-gray-400">—</span>;
  }

  return (
    <div className="min-w-0 max-w-[14rem] space-y-1">
      {catalog ? (
        <p className="text-[10px] text-gray-800 whitespace-pre-wrap break-words leading-snug" title={catalog}>
          {catalog}
        </p>
      ) : null}
      {LineNotesContent.hasContent({ notes: tailor, noteImage: image }) ? (
        <div>
          <span className="text-[10px] font-semibold text-gray-600">Tailor: </span>
          <LineNotesContent notes={tailor} noteImage={image} compact clampText />
        </div>
      ) : null}
    </div>
  );
}

ItemStageProductNotesContent.propTypes = {
  row: PropTypes.object.isRequired,
};

export function buildItemStageProductNotesColumn() {
  return {
    key: 'product_notes',
    columnPickerLabel: 'Product notes',
    header: 'Product notes',
    className: 'text-xs align-top whitespace-normal max-w-[14rem]',
    render: (r) => <ItemStageProductNotesContent row={r} />,
  };
}

export function buildItemStageAllNotesColumn() {
  return {
    key: 'all_notes',
    columnPickerLabel: 'All notes',
    header: 'All notes',
    className: 'text-xs align-top whitespace-normal max-w-[18rem]',
    render: (r) => <ItemStageAllNotesContent row={r} />,
  };
}

/** @param {object} row */
export function itemStageAllNotesPlainText(row) {
  return formatItemStageAllNotes(row);
}

/** @param {object} row */
export function itemStageProductNotesPlainText(row) {
  return formatItemStageProductRemarks(row);
}
