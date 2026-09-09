const paise = (value) => Math.round(Number(value) * 100);
const rupees = (value) => value / 100;

/** Largest-remainder allocation keeps discounts and split invoices exact to the paise. */
export function allocateGstGross(total, weights) {
  const cents = paise(total);
  const sum = weights.reduce((a, b) => a + Math.max(0, Number(b)), 0);
  if (!sum) return weights.map(() => 0);
  const shares = weights.map((w, index) => {
    const exact = (cents * Math.max(0, Number(w))) / sum;
    return { index, value: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remainder = cents - shares.reduce((a, b) => a + b.value, 0);
  for (const row of [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (remainder-- > 0) row.value += 1;
  }
  return shares.map((row) => rupees(row.value));
}

export function calculateGstAllocation(source, input) {
  const gross = paise(source.total_amount);
  const target = Math.round((gross * Number(input.percentage)) / 100);
  if (
    !Number.isSafeInteger(gross) ||
    gross <= 0 ||
    !Number.isFinite(input.percentage) ||
    input.percentage <= 0 ||
    input.percentage > 100 ||
    target < 1
  )
    throw new Error('Invalid GST allocation amount');
  if (input.components.length !== source.lines.length)
    throw new Error('Review every original bill component');
  const seen = new Set();
  const interstate = source.supplier.gstin.slice(0, 2) !== input.place_of_supply;
  const lines = input.components.map((part) => {
    const original = source.lines.find((line) => line.line_key === part.line_key);
    if (!original || seen.has(part.line_key))
      throw new Error('Unknown or duplicate bill component');
    seen.add(part.line_key);
    const amount = paise(part.gst_gross);
    const remaining = paise(original.gross_amount) - amount;
    if (!Number.isSafeInteger(amount) || amount < 0 || remaining < 0)
      throw new Error('GST portion exceeds its original component amount');
    if (remaining > 0 && String(part.non_gst_reason || '').trim().length < 3)
      throw new Error('Describe the actual non-GST component and its tax treatment');
    if (!Number.isFinite(part.tax_rate) || part.tax_rate <= 0 || part.tax_rate > 100)
      throw new Error('Enter a valid GST tax rate');
    const taxable = Math.round((amount * 10000) / (10000 + Math.round(part.tax_rate * 100)));
    const tax = amount - taxable;
    const cgst = interstate ? 0 : Math.round(tax / 2);
    return {
      ...original,
      ...part,
      taxable_value: rupees(taxable),
      tax_total: rupees(tax),
      cgst: rupees(cgst),
      sgst: interstate ? 0 : rupees(tax - cgst),
      igst: interstate ? rupees(tax) : 0,
      non_gst_amount: rupees(remaining),
    };
  });
  if (lines.reduce((sum, row) => sum + paise(row.gst_gross), 0) !== target)
    throw new Error(
      'Component GST amounts must equal the selected percentage of the original bill'
    );
  const totals = Object.fromEntries(
    ['taxable_value', 'tax_total', 'cgst', 'sgst', 'igst'].map((key) => [
      key,
      rupees(lines.reduce((sum, row) => sum + paise(row[key]), 0)),
    ])
  );
  return {
    ...totals,
    grand_total: rupees(target),
    non_gst_amount: rupees(gross - target),
    percentage: input.percentage,
    tax_mode: interstate ? 'igst' : 'cgst_sgst',
    lines,
  };
}

export function gstFinancialYear(date) {
  const [year, month] = String(date).split('-').map(Number);
  const start = month < 4 ? year - 1 : year;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}
