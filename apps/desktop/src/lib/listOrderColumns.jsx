import { formatCurrency } from '@wrs/shared';

/** @param {Record<string, unknown>} row */
export function resolveOrderAddress(row) {
  return String(row?.customer_address || '').trim();
}

/** Rent bill balance still due (orders.balance). */
export function resolveOrderPendingAmount(row) {
  return Math.max(0, Number(row?.balance ?? 0));
}

/** Customer address — toggleable via column picker; shown by default on booking/delivery/return lists. */
export function buildCustomerAddressColumn(overrides = {}) {
  return {
    key: 'customer_address',
    header: 'Address',
    columnPickerLabel: 'Address',
    className: 'text-xs max-w-[11rem]',
    render: (r) => {
      const addr = resolveOrderAddress(r);
      if (!addr) return <span className="text-gray-400">—</span>;
      return (
        <span
          className="block text-xs text-gray-700 max-w-[11rem] truncate whitespace-nowrap"
          title={addr}
        >
          {addr}
        </span>
      );
    },
    ...overrides,
  };
}

function renderQtyCell(value) {
  const n = Number(value ?? 0);
  return <span className="tabular-nums">{Number.isFinite(n) ? n : 0}</span>;
}

/** Order-level sum of product line qty (order_items). */
export function buildProductQtyColumn(overrides = {}) {
  return {
    key: 'product_qty',
    header: 'Product',
    columnPickerLabel: 'Product',
    align: 'right',
    className: 'text-xs',
    render: (r) => renderQtyCell(r.product_qty),
    ...overrides,
  };
}

/** Order-level sum of all accessory line qty (linked + standalone). */
export function buildAccessoryQtyColumn(overrides = {}) {
  return {
    key: 'accessory_qty',
    header: 'Accessories',
    columnPickerLabel: 'Accessories',
    align: 'right',
    className: 'text-xs',
    render: (r) => renderQtyCell(r.accessory_qty),
    ...overrides,
  };
}

/** @param {Record<string, unknown>} row */
export function resolveOrderLineCounts(row) {
  const products = Number(row?.product_qty ?? 0);
  const accessories = Number(row?.accessory_qty ?? 0);
  return {
    products: Number.isFinite(products) ? products : 0,
    accessories: Number.isFinite(accessories) ? accessories : 0,
  };
}

/** Pending rent amount due (orders.balance). */
export function buildPendingAmountColumn(overrides = {}) {
  return {
    key: 'balance',
    header: 'Pending Amount',
    columnPickerLabel: 'Pending Amount',
    align: 'right',
    className: 'text-xs',
    render: (r) => {
      const pending = resolveOrderPendingAmount(r);
      if (pending <= 0) {
        return <span className="tabular-nums text-gray-500">{formatCurrency(0)}</span>;
      }
      return (
        <span className="tabular-nums font-medium text-red-600">{formatCurrency(pending)}</span>
      );
    },
    ...overrides,
  };
}
