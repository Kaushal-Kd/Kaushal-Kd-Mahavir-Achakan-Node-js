import { allocateGstGross, gstinSchema } from '@wrs/shared';

export function readGstDecimal(value, label = 'Amount') {
  const text = String(value ?? '').trim();
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text) || !Number.isFinite(Number(text)))
    throw new Error(`${label}: enter a number with up to two decimal places`);
  return Number(text);
}

export function readGstPercentage(value, label = 'GST allocation %') {
  const number = readGstDecimal(value, label);
  if (number <= 0 || number > 100)
    throw new Error(`${label}: enter a percentage greater than 0 and at most 100`);
  return number;
}

/** Keep text drafts editable; only validated numbers cross the API/offline queue boundary. */
export function normalizeGstInvoiceInput(input) {
  return {
    ...input,
    percentage: readGstPercentage(input.percentage),
    components: input.components.map((line, index) => ({
      ...line,
      gst_gross: readGstDecimal(line.gst_gross, `Item ${index + 1} GST portion`),
      tax_rate: readGstPercentage(line.tax_rate, `Item ${index + 1} GST tax rate %`),
    })),
  };
}

export function getGstSourceIssues(source) {
  const issues = [];
  if (!gstinSchema.safeParse(source.supplier?.gstin).success || !source.supplier?.address?.trim())
    issues.push(
      "This shop needs a valid supplier GSTIN and address in Settings > Shops / Branches. Recipient GSTIN is the customer's GSTIN and does not configure the shop."
    );
  if (!source.customer_name?.trim() || !source.customer_address?.trim())
    issues.push(
      'Save the customer name and address on the original bill before reviewing GST invoices.'
    );
  return issues;
}

export function applyGstDraftPercentage(draft, percentage) {
  const input = { ...draft.input, percentage };
  let number;
  try {
    number = readGstPercentage(percentage);
  } catch {
    return { ...draft, input };
  }
  const gross = Math.round(draft.source.total_amount * number) / 100;
  const amounts = allocateGstGross(
    gross,
    draft.source.lines.map((line) => line.gross_amount)
  );
  return {
    ...draft,
    input: {
      ...input,
      components: draft.input.components.map((line, index) => ({
        ...line,
        gst_gross: amounts[index],
      })),
    },
  };
}

export function createGstInvoiceDraft(source, percentage, taxRate) {
  return applyGstDraftPercentage(
    {
      source,
      input: {
        source_type: source.source_type,
        source_id: source.source_id,
        source_fingerprint: source.source_fingerprint,
        percentage: 0,
        recipient_gstin: '',
        place_of_supply: source.supplier.gstin.slice(0, 2),
        components: source.lines.map((line) => ({
          line_key: line.line_key,
          description: line.name,
          hsn_sac: '',
          gst_gross: 0,
          tax_rate: Number(taxRate) > 0 ? Number(taxRate) : '',
          non_gst_reason: '',
        })),
      },
    },
    percentage
  );
}
