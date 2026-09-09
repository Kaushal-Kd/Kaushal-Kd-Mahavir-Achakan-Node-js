/**
 * Map a sale record (from salesApi.get) into order shape for printBill / bill templates.
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function lineTax(row) {
  return round2(
    Number(row.cgst_amount || 0) + Number(row.sgst_amount || 0) + Number(row.igst_amount || 0)
  );
}

function mapSaleLine(row) {
  return {
    id: row.id,
    type: 'sell',
    name_snapshot: row.name_snapshot || '-',
    code_snapshot: row.code_snapshot || '',
    category_name: row.category_name || '',
    qty: Number(row.qty || 1),
    price: round2(row.price),
    discount: round2(row.discount),
    tax: lineTax(row),
    total: round2(row.total_amount),
    line_total: round2(row.total_amount),
  };
}

/**
 * @param {object} sale — full sale from GET /sales/:id
 * @returns {object} order-shaped payload for printBill
 */
export function saleToBillOrder(sale) {
  if (!sale) return null;

  const items = [];
  const accessories = [];

  for (const row of sale.items || []) {
    const line = mapSaleLine(row);
    if (String(row.item_type || '').toLowerCase() === 'product') {
      items.push(line);
    } else {
      accessories.push({ ...line, order_item_id: null });
    }
  }

  const totalAmount = round2(sale.total_amount);
  const advance = round2(sale.advance);

  return {
    order_number: sale.sale_number || '',
    booking_date: sale.sale_date,
    customer_name: sale.customer_name || '',
    customer_phone: sale.contact_no || '',
    customer_address: sale.address || '',
    customer_notes: sale.remark || '',
    reference_name: sale.sales_person_name || '',
    subtotal: round2(sale.subtotal),
    discount_amount: round2(sale.discount_amount),
    tax_amount: round2(sale.tax_total),
    total_amount: totalAmount,
    paid_amount: advance,
    balance: Math.max(0, totalAmount - advance),
    items,
    accessories,
  };
}
