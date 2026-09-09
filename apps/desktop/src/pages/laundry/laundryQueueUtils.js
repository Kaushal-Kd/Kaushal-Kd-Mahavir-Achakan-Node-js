import { resolveLaundryPriority } from '@wrs/shared';

export const PRIORITY_RANK = {
  Urgent: 1,
  High: 2,
  Medium: 3,
  Low: 4,
  'No Schedule': 5,
};

export const PRIORITY_TONE = {
  Urgent: 'bg-red-100 text-red-700',
  High: 'bg-orange-100 text-orange-700',
  Medium: 'bg-yellow-100 text-yellow-700',
  Low: 'bg-blue-100 text-blue-700',
  'No Schedule': 'bg-gray-100 text-gray-700',
};

export const QUEUE_SORT_OPTIONS = [
  { value: 'priority', label: 'Priority' },
  { value: 'name', label: 'Name' },
  { value: 'code', label: 'Code' },
];

export function getDaysLeft(dateValue) {
  if (!dateValue) return null;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - todayStart.getTime()) / 86400000);
}

export function getPriority(daysLeft, prioritySettings) {
  return resolveLaundryPriority(daysLeft, prioritySettings);
}

export function resolveNextBookingLink(row) {
  const upcoming = Array.isArray(row?.upcomingBookings)
    ? row.upcomingBookings
    : Array.isArray(row?.upcoming_bookings)
      ? row.upcoming_bookings
      : [];
  const primary = upcoming[0] || null;
  return {
    orderId: row?.nextBookingOrderId || primary?.order_id || null,
    label: row?.bookingNo || row?.nextBookingNo || primary?.order_number || null,
  };
}

export function presentWashingQueueItem(item, prioritySettings) {
  const nextPickupDate = item.next_pickup_date || null;
  const daysLeft = getDaysLeft(nextPickupDate);
  return {
    ...item,
    nextPickupDate,
    daysLeft,
    priority: getPriority(daysLeft, prioritySettings),
    nextBookingNo: item.next_booking_no || null,
    nextCustomerName: item.next_customer_name || null,
    upcomingBookings: Array.isArray(item.upcoming_bookings) ? item.upcoming_bookings : [],
  };
}

export function filterWashingQueue(items, search) {
  const term = String(search || '')
    .trim()
    .toLowerCase();
  if (!term) return items;
  return items.filter((item) => {
    const haystack = [
      item.code,
      item.name,
      item.category_label,
      item.order_number,
      item.next_booking_no,
      item.next_customer_name,
    ]
      .map((value) => String(value || '').toLowerCase())
      .join(' ');
    return haystack.includes(term);
  });
}

/** Group accessory lines for the washing table while retaining SKU-level detail. */
export function groupLaundryAccessoriesByCategory(rows) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const label = String(row.categoryLabel || 'Uncategorized').trim() || 'Uncategorized';
    const key = String(row.categoryId || `label:${label.toLowerCase()}`);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        categoryId: row.categoryId || '',
        label,
        rows: [],
        qty: 0,
        qtyReturned: 0,
        lineTotal: 0,
      });
    }
    const group = groups.get(key);
    group.rows.push(row);
    group.qty += Number(row.qty || 0);
    group.qtyReturned += Number(row.qtyReturned || 0);
    group.lineTotal += Number(row.qty || 0) * Number(row.rate || 0);
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  );
}

/** Filter laundry job product lines by category and code/name search. */
export function sortLaundryJobProductsByPriority(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const rankDiff = (PRIORITY_RANK[a.priority] || 99) - (PRIORITY_RANK[b.priority] || 99);
    if (rankDiff !== 0) return rankDiff;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
      sensitivity: 'base',
    });
  });
}

export function accessoryPendingQty(row) {
  const sent = Number(row?.qty || 0);
  const returned = Number(row?.qtyReturned || 0);
  return Math.max(0, sent - returned);
}

export function filterLaundryJobProducts(rows, { categoryId, search } = {}) {
  let out = Array.isArray(rows) ? rows : [];
  const cat = String(categoryId || '').trim();
  if (cat) {
    out = out.filter((row) => (row.categoryId || 'uncategorized') === cat);
  }
  const term = String(search || '')
    .trim()
    .toLowerCase();
  if (!term) return out;
  return out.filter((row) => {
    const haystack = [row.code, row.name]
      .map((value) => String(value || '').toLowerCase())
      .join(' ');
    return haystack.includes(term);
  });
}

export function sortWashingQueue(items, sortBy, prioritySettings) {
  const presented = items.map((item) => presentWashingQueueItem(item, prioritySettings));
  return [...presented].sort((a, b) => {
    if (sortBy === 'code') {
      return String(a.code || '').localeCompare(String(b.code || ''), undefined, {
        sensitivity: 'base',
      });
    }
    if (sortBy === 'name') {
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        sensitivity: 'base',
      });
    }
    const rankDiff = (PRIORITY_RANK[a.priority] || 99) - (PRIORITY_RANK[b.priority] || 99);
    if (rankDiff !== 0) return rankDiff;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
      sensitivity: 'base',
    });
  });
}
