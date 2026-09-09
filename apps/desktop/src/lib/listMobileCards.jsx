import { formatCurrency, formatDate } from '@wrs/shared';

import BookingBillLink from '../components/booking/BookingBillLink.jsx';
import SmartImage from '../components/ui/SmartImage.jsx';
import { resolveOrderLineCounts } from './listOrderColumns.jsx';

/** Mobile card body for catalog product / accessory rows. */
export function catalogItemMobileCard(row, { imageKey = 'main_image', subtitleKey = 'code' } = {}) {
  const img = row[imageKey] || row.image_url;
  const sub = row[subtitleKey] || row.code || '';
  return (
    <div className="flex gap-3 min-w-0">
      <SmartImage
        src={img}
        alt={row.name || 'Item'}
        className="w-12 h-12 rounded border border-gray-200 bg-white object-contain shrink-0"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-medium text-sm text-gray-900 break-words">{row.name || '—'}</div>
        {sub ? <div className="text-xs font-mono text-gray-500">{sub}</div> : null}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
          {row.price_rent != null ? <span>Rent {formatCurrency(row.price_rent)}</span> : null}
          {row.price_sell != null ? <span>Sell {formatCurrency(row.price_sell)}</span> : null}
          {row.is_active === false || row.is_active === 0 ? (
            <span className="font-medium text-red-600">Deactive</span>
          ) : row.display_status || row.status ? (
            <span className="capitalize">{String(row.display_status || row.status).replace(/_/g, ' ')}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Mobile card for booking / order list rows. */
export function bookingListMobileCard(row) {
  const title = row.order_number || row.bill_no || row.id;
  const customer = row.customer_name || row.pickup_name || '';
  const { products, accessories } = resolveOrderLineCounts(row);
  return (
    <div className="space-y-1 min-w-0">
      <div className="font-medium text-sm break-words">
        <BookingBillLink orderId={row.id} className="text-gray-900 hover:text-brand">
          {title}
        </BookingBillLink>
      </div>
      {customer ? <div className="text-xs text-gray-600">{customer}</div> : null}
      <div className="flex flex-wrap gap-x-3 text-xs text-gray-500">
        {products > 0 ? <span className="tabular-nums">Products {products}</span> : null}
        {accessories > 0 ? <span className="tabular-nums">Accessories {accessories}</span> : null}
        {row.pickup_date ? <span>Pickup {formatDate(row.pickup_date)}</span> : null}
        {row.return_date ? <span>Return {formatDate(row.return_date)}</span> : null}
        {row.status ? <span className="capitalize">{String(row.status).replace(/_/g, ' ')}</span> : null}
      </div>
    </div>
  );
}

/** Mobile card for customer list rows. */
export function customerListMobileCard(row) {
  return (
    <div className="flex gap-3 min-w-0">
      <SmartImage
        src={row.photo_url}
        alt={row.name}
        className="w-10 h-10 rounded border border-gray-200 bg-white object-contain shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm text-gray-900">{row.name || '—'}</div>
        <div className="text-xs text-gray-600">{row.phone1 || row.phone2 || '—'}</div>
      </div>
    </div>
  );
}

/** Generic list row with title + subtitle + optional meta. */
export function simpleListMobileCard(row, { title, subtitle, meta }) {
  return (
    <div className="space-y-1 min-w-0">
      <div className="font-medium text-sm text-gray-900 break-words">{title}</div>
      {subtitle ? <div className="text-xs text-gray-600">{subtitle}</div> : null}
      {meta ? <div className="text-xs text-gray-500">{meta}</div> : null}
    </div>
  );
}
