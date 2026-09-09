import { round2 } from '@wrs/shared';

/**
 * @param {string|null|undefined} vendorAccountId
 * @param {string|null|undefined} vendorName
 */
export function normalizeVendorName(vendorName) {
  return String(vendorName || '').trim().toLowerCase();
}

/**
 * @param {string|null|undefined} vendorAccountId
 * @param {string|null|undefined} vendorName
 */
export function vendorMatchScope(vendorAccountId, vendorName) {
  const accountId = String(vendorAccountId || '').trim();
  const name = normalizeVendorName(vendorName);
  return { accountId, name };
}

/**
 * @param {import('knex').Knex.QueryBuilder} qb
 * @param {{ accountId: string, name: string }} scope
 * @param {string} [tableAlias]
 */
export function applyVendorScopeToQuery(qb, scope, tableAlias = 'lj') {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  if (scope.accountId) {
    qb.andWhere(function vendorScope() {
      this.where(`${prefix}vendor_account_id`, scope.accountId).orWhere(function legacyNameMatch() {
        this.whereNull(`${prefix}vendor_account_id`).andWhereRaw(
          `LOWER(TRIM(${prefix}vendor_name)) = ?`,
          [scope.name]
        );
      });
    });
  } else if (scope.name) {
    qb.andWhereRaw(`LOWER(TRIM(${prefix}vendor_name)) = ?`, [scope.name]);
  }
}

/**
 * @param {Array<{ id: string, job_no?: string, laundry_date?: string, laundry_at?: string, payable_amount?: number, paid_to_washing_amount?: number }>} rows
 */
export function buildOutstandingFromJobRows(rows) {
  const bills = [];
  let totalPayable = 0;
  let totalPaid = 0;
  let totalRemaining = 0;

  for (const row of rows || []) {
    const payable = Number(row.payable_amount || 0);
    const paid = Number(row.paid_to_washing_amount || 0);
    const remaining = payable - paid;
    if (remaining <= 1e-6) continue;

    bills.push({
      id: row.id,
      jobNo: row.job_no,
      laundryDate: row.laundry_at || row.laundry_date || null,
      payable: round2(payable),
      paid: round2(paid),
      remaining: round2(remaining),
    });
    totalPayable += payable;
    totalPaid += paid;
    totalRemaining += remaining;
  }

  bills.sort((a, b) =>
    String(a.jobNo || '').localeCompare(String(b.jobNo || ''), undefined, {
      sensitivity: 'base',
      numeric: true,
    })
  );

  return {
    bills,
    totals: {
      totalPayable: round2(totalPayable),
      totalPaid: round2(totalPaid),
      totalRemaining: round2(totalRemaining),
      billCount: bills.length,
    },
  };
}

/**
 * @param {Array<{ id: string, created_at: string|Date, bill_seq?: number|null }>} rows
 * @returns {string|null}
 */
export function findLatestJobId(rows) {
  if (!rows?.length) return null;

  let latest = rows[0];
  for (const row of rows) {
    const rowTime = new Date(row.created_at).getTime();
    const latestTime = new Date(latest.created_at).getTime();
    if (Number.isNaN(rowTime) || Number.isNaN(latestTime)) continue;

    if (rowTime > latestTime) {
      latest = row;
      continue;
    }
    if (rowTime < latestTime) continue;

    const rowSeq = Number(row.bill_seq || 0);
    const latestSeq = Number(latest.bill_seq || 0);
    if (rowSeq > latestSeq) latest = row;
  }

  return latest?.id || null;
}

/**
 * @param {string|null|undefined} vendorAccountId
 * @param {string|null|undefined} vendorName
 */
export function vendorListKey(vendorAccountId, vendorName) {
  const accountId = String(vendorAccountId || '').trim();
  if (accountId) return accountId;
  const name = normalizeVendorName(vendorName);
  return name ? `name:${name}` : '';
}
