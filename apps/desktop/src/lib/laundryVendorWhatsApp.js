import { isIndianPhone, normalizePhone, phoneInputDigits } from '@wrs/shared';

const VENDOR_ACCOUNT_GROUPS = new Set(['vendors', 'laundry vendor']);

/**
 * @param {string} raw
 * @returns {string}
 */
export function tenDigitContactPhone(raw) {
  const d = phoneInputDigits(raw) || normalizePhone(raw) || '';
  return d.length === 10 && isIndianPhone(d) ? d : '';
}

/**
 * @param {object} account
 * @returns {boolean}
 */
function isVendorPaymentAccount(account) {
  const group = String(account?.account_group || '').trim().toLowerCase();
  return VENDOR_ACCOUNT_GROUPS.has(group);
}

/**
 * Resolve vendor WhatsApp recipient from linked payment account or name match.
 *
 * @param {{ vendorAccountId?: string | null, vendorName?: string | null, paymentAccounts?: object[] }} opts
 * @returns {{ phone: string, account: object | null } | null}
 */
export function resolveVendorContactPhone({ vendorAccountId, vendorName, paymentAccounts }) {
  const list = Array.isArray(paymentAccounts) ? paymentAccounts : [];
  const vendors = list.filter(isVendorPaymentAccount);

  if (vendorAccountId) {
    const account = vendors.find((a) => a.id === vendorAccountId) || list.find((a) => a.id === vendorAccountId);
    if (account) {
      const phone = tenDigitContactPhone(account.contact_no);
      if (phone) return { phone, account };
    }
  }

  const name = String(vendorName || '').trim().toLowerCase();
  if (!name) return null;

  const matches = vendors.filter((a) => String(a.name || '').trim().toLowerCase() === name);
  if (matches.length === 1) {
    const phone = tenDigitContactPhone(matches[0].contact_no);
    if (phone) return { phone, account: matches[0] };
  }

  return null;
}

/**
 * Context for LAUNDRY_SLIP WhatsApp template rendering.
 *
 * @param {object} job
 * @param {string} [shopName]
 * @returns {Record<string, string>}
 */
export function buildLaundrySlipWhatsAppContext(job, shopName = '') {
  return {
    customer_name: String(job?.vendorName || job?.vendor || '').trim(),
    shop_name: String(shopName || '').trim(),
    bill_no: String(job?.jobNo || job?.job_no || '').trim(),
    product_name: '',
    items: '',
    discount: '',
    total_rent: '',
    advance: '',
    pending_amount: '',
    security: '',
    bill_notes: '',
    bill_pdf: '',
  };
}
