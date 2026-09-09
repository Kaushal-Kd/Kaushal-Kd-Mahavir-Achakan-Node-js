import { toLocalISODate } from '@wrs/shared';

import { downloadCsv } from '../utils/csv.js';

/** Fixed export columns — always complete, independent of table column picker. */
export const PRODUCT_EXPORT_COLUMNS = [
  { key: 'id', header: 'ID' },
  { key: 'code', header: 'Code' },
  { key: 'name', header: 'Name' },
  { key: 'type', header: 'Type' },
  { key: 'category_id', header: 'Category ID' },
  { key: 'category_name', header: 'Category name' },
  { key: 'qty', header: 'Qty' },
  { key: 'price_rent', header: 'Rent price' },
  { key: 'price_sell', header: 'Sell price' },
  { key: 'purchase_price', header: 'Purchase price' },
  { key: 'color', header: 'Color' },
  { key: 'size', header: 'Size' },
  { key: 'lifetime_gap', header: 'Lifetime gap' },
  { key: 'count', header: 'Rental count' },
  { key: 'status', header: 'Status' },
  { key: 'display_status', header: 'Display status' },
  { key: 'booked_qty', header: 'Booked qty' },
  { key: 'in_delivery_qty', header: 'In delivery qty' },
  { key: 'returned_qty', header: 'Returned qty' },
  { key: 'washing_qty', header: 'Washing qty' },
  { key: 'vendor_id', header: 'Vendor ID' },
  { key: 'main_image', header: 'Main image URL' },
  { key: 'gallery_image_urls', header: 'Gallery image URLs' },
  { key: 'notes', header: 'Design Details' },
  { key: 'is_active', header: 'Active' },
  { key: 'accessory_names', header: 'Accessory names' },
  { key: 'last_delivered_at', header: 'Last delivered at' },
  { key: 'last_returned_at', header: 'Last returned at' },
  { key: 'created_at', header: 'Created at' },
  { key: 'updated_at', header: 'Updated at' },
];

/**
 * @param {object[]} rows
 */
export function downloadProductExportCsv(rows) {
  const stamp = toLocalISODate(new Date());
  downloadCsv(`products_export_${stamp}.csv`, PRODUCT_EXPORT_COLUMNS, rows || []);
}
