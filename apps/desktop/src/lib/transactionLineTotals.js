export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function computeItemTotals(item) {
  const qty = Math.max(1, Number(item.qty) || 1);
  const price = Number(item.price) || 0;
  const discount = Number(item.discount) || 0;
  const taxablePrice = round2(Math.max(0, price - discount));
  const taxableTotal = round2(taxablePrice * qty);
  const cgstPct = Number(item.cgst_percent) || 0;
  const sgstPct = Number(item.sgst_percent) || 0;
  const igstPct = Number(item.igst_percent) || 0;
  const cgstAmt = round2(taxableTotal * cgstPct / 100);
  const sgstAmt = round2(taxableTotal * sgstPct / 100);
  const igstAmt = round2(taxableTotal * igstPct / 100);
  const netPrice = round2(taxableTotal + cgstAmt + sgstAmt + igstAmt);
  return {
    ...item,
    qty,
    taxable_price: taxablePrice,
    cgst_amount: cgstAmt,
    sgst_amount: sgstAmt,
    igst_amount: igstAmt,
    net_price: netPrice,
    total_amount: netPrice,
  };
}

export function computeTransactionTotals(items, discount) {
  const discountType = discount.type || 'flat';
  const discountValue = Number(discount.value) || 0;

  let subtotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;
  let totalQty = 0;

  for (const item of items) {
    const c = computeItemTotals(item);
    subtotal += round2(c.taxable_price * c.qty);
    cgstTotal += c.cgst_amount;
    sgstTotal += c.sgst_amount;
    igstTotal += c.igst_amount;
    totalQty += c.qty;
  }

  subtotal = round2(subtotal);
  const taxTotal = round2(cgstTotal + sgstTotal + igstTotal);
  const netAmount = round2(subtotal + taxTotal);
  const discountAmount =
    discountType === 'percent'
      ? round2((netAmount * discountValue) / 100)
      : round2(Math.min(discountValue, netAmount));
  const totalAmount = round2(Math.max(0, netAmount - discountAmount));

  return {
    subtotal,
    cgst_total: round2(cgstTotal),
    sgst_total: round2(sgstTotal),
    igst_total: round2(igstTotal),
    tax_total: taxTotal,
    net_amount: netAmount,
    discount_amount: discountAmount,
    total_amount: totalAmount,
    total_qty: totalQty,
  };
}
