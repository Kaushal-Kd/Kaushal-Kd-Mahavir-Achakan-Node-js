import { normalizeSqlDateToIso, round2 } from '@wrs/shared';

export function conditionOperationDateError(paymentDate, latestDate) {
  const latest = normalizeSqlDateToIso(latestDate);
  if (latest && normalizeSqlDateToIso(paymentDate) < latest) {
    return `Operation date cannot precede existing condition-money activity for this booking (${latest})`;
  }
  return null;
}

export function summarizeChargeOperations(assessedAmount, operations = []) {
  const totals = { collected: 0, retained: 0, refunded: 0, released: 0, settled: 0 };
  const key = {
    collect: 'collected',
    retain: 'retained',
    refund: 'refunded',
    release: 'released',
    settle: 'settled',
  };
  for (const operation of operations) {
    if (key[operation.kind]) totals[key[operation.kind]] += Number(operation.amount || 0);
  }
  for (const name of Object.keys(totals)) totals[name] = round2(totals[name]);
  const held = round2(
    totals.collected + totals.retained - totals.refunded - totals.released - totals.settled
  );
  return {
    ...totals,
    assessed: round2(Number(assessedAmount || 0)),
    held,
    uncollected: round2(Math.max(0, Number(assessedAmount || 0) - held - totals.settled)),
    refundable_excess: round2(
      Math.min(held, Math.max(0, held + totals.settled - Number(assessedAmount || 0)))
    ),
    settled_surplus: round2(Math.max(0, totals.settled - Number(assessedAmount || 0))),
  };
}

export function fundingLotBalances(operations = []) {
  return operations
    .filter((row) => ['collect', 'retain'].includes(row.kind))
    .map((lot) => ({
      ...lot,
      available: round2(
        Number(lot.amount) -
          operations
            .filter((row) => row.funding_operation_id === lot.id)
            .reduce((sum, row) => sum + Number(row.amount), 0)
      ),
    }));
}

export function buildConditionDepositReconciliation(operations, from, to) {
  const byId = new Map(operations.map((row) => [row.id, row]));
  const rows = new Map();
  const signs = { collect: 1, retain: 1, refund: -1, release: -1, settle: -1 };
  const names = {
    collect: 'collected',
    retain: 'retained',
    refund: 'refunded',
    release: 'released',
    settle: 'recognized',
  };
  for (const operation of operations) {
    const date = String(operation.payment_date || '').slice(0, 10);
    if (date > to) continue;
    const source = operation.funding_operation_id
      ? byId.get(operation.funding_operation_id)
      : operation;
    if (!source) continue;
    const family = source.payment_account_id ? 'payment' : 'security';
    const accountId = source.payment_account_id || source.security_account_id;
    const id = `condition:${family}:${accountId}`;
    if (!rows.has(id))
      rows.set(id, {
        id,
        account_id: accountId,
        account_family: family,
        account_name: source.account_name || accountId,
        opening_held: 0,
        collected: 0,
        retained: 0,
        refunded: 0,
        released: 0,
        recognized: 0,
        operations: [],
      });
    const row = rows.get(id);
    if (date < from) row.opening_held += signs[operation.kind] * Number(operation.amount);
    else {
      row[names[operation.kind]] += Number(operation.amount);
      row.operations.push(operation);
    }
  }
  const data = [...rows.values()].map((row) => {
    for (const field of [
      'opening_held',
      'collected',
      'retained',
      'refunded',
      'released',
      'recognized',
    ])
      row[field] = round2(row[field]);
    return {
      ...row,
      closing_held: round2(
        row.opening_held +
          row.collected +
          row.retained -
          row.refunded -
          row.released -
          row.recognized
      ),
    };
  });
  const summary = Object.fromEntries(
    [
      'opening_held',
      'collected',
      'retained',
      'refunded',
      'released',
      'recognized',
      'closing_held',
    ].map((field) => [field, round2(data.reduce((sum, row) => sum + row[field], 0))])
  );
  return { rows: data, summary, supplemental: true };
}
