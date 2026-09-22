import { Phone } from 'lucide-react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';

import { damageReplacementsForRow, rowHasDamageReplacement } from '../../lib/damageReplacementAlert.js';

function digitsForTel(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : '';
}

export default function DamageReplacementBadge({ row }) {
  if (!rowHasDamageReplacement(row)) return null;
  const items = damageReplacementsForRow(row);
  const first = items[0] || {};
  const phone = first.customer_phone || row.customer_phone || '';
  const tel = digitsForTel(phone);
  const labels = [...new Set(items.map((item) => item.source_product_label).filter(Boolean))];
  const productText = labels.length === 1 ? labels[0] : labels.length > 1 ? `${labels.length} products` : 'Product';
  const bookingId = row.order_id && String(row.order_id) !== String(row.id) ? row.order_id : row.id;

  return (
    <span className="inline-flex max-w-[16rem] flex-wrap items-center gap-1">
      <span className="inline-flex items-center rounded border border-red-200 bg-white px-1 py-0.5 text-[10px] font-semibold uppercase leading-none text-red-700">
        Damaged
      </span>
      <span className="text-[10px] font-medium text-red-800">{productText}</span>
      {tel ? (
        <a
          href={`tel:${tel}`}
          className="inline-flex items-center gap-0.5 font-mono text-[10px] font-semibold text-red-800 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          <Phone size={11} aria-hidden="true" />
          {phone}
        </a>
      ) : bookingId ? (
        <Link
          to={`/booking/${bookingId}`}
          className="text-[10px] font-medium text-brand hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          Replace
        </Link>
      ) : null}
    </span>
  );
}

DamageReplacementBadge.propTypes = {
  row: PropTypes.object,
};
