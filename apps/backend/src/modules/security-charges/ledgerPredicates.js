/** Real direct condition receipts/refunds are separate from the booking's capped security. */
export function excludeDirectConditionPayments(query, alias = 'payments') {
  return query.whereNotExists(function directCondition() {
    this.select(1)
      .from('security_charge_operations as cp')
      .leftJoin('security_charge_operations as cf', 'cf.id', 'cp.funding_operation_id')
      .whereRaw(`cp.payment_id = ${alias}.id AND cp.shop_id = ${alias}.shop_id`)
      .where(function source() {
        this.where('cp.kind', 'collect').orWhere('cf.kind', 'collect');
      });
  });
}

/** Deposits are not earned income; the explicit settle entry is the recognition. */
export function excludeConditionPaymentMovements(query, alias = 'payments') {
  return query.whereNotExists(function conditionPayment() {
    this.select(1)
      .from('security_charge_operations as cp')
      .whereRaw(`cp.payment_id = ${alias}.id AND cp.shop_id = ${alias}.shop_id`);
  });
}

/** Recognition reclassifies held money; it never debits bank/cash for a second receipt. */
export function excludeConditionIncomeCashLeg(query, alias = 'income_entries') {
  return query.whereNotExists(function recognition() {
    this.select(1)
      .from('security_charge_operations as co')
      .whereRaw(`co.income_entry_id = ${alias}.id AND co.shop_id = ${alias}.shop_id`);
  });
}

export function retainedConditionAllocationSql(orderRef) {
  return `(COALESCE((SELECT SUM(CASE WHEN co.kind = 'retain' THEN co.amount
    WHEN co.kind IN ('release', 'refund') AND cf.kind = 'retain' THEN -co.amount ELSE 0 END)
    FROM security_charge_operations co
    LEFT JOIN security_charge_operations cf ON cf.id = co.funding_operation_id
    WHERE co.order_id = ${orderRef}), 0)
    + COALESCE((SELECT SUM(sc.amount) FROM security_charges sc
      WHERE sc.order_id = ${orderRef} AND sc.money_flow_version IS NULL AND sc.status <> 'void'
      AND (sc.funding_source = 'security_retained' OR (sc.funding_source IS NULL AND sc.source = 'return_modal'))), 0))`;
}

/** Filter recorded allocations with the same account/date boundaries as payment movements. */
export function retainedConditionAllocationExpression(db, orderRef, filters = {}) {
  const operationFilters = [];
  const legacyFilters = [];
  const operationBindings = [];
  const legacyBindings = [];
  if (filters.securityAccountId) {
    operationFilters.push('co.security_account_id = ?');
    legacyFilters.push('sc.security_account_id = ?');
    operationBindings.push(filters.securityAccountId);
    legacyBindings.push(filters.securityAccountId);
  }
  for (const [name, operator] of [
    ['from', '>='],
    ['to', '<='],
    ['before', '<'],
  ]) {
    if (filters[name]) {
      operationFilters.push(`co.payment_date ${operator} ?`);
      legacyFilters.push(`DATE(sc.created_at) ${operator} ?`);
      operationBindings.push(filters[name]);
      legacyBindings.push(filters[name]);
    }
  }
  const operationScope = operationFilters.length ? ` AND ${operationFilters.join(' AND ')}` : '';
  const legacyScope = legacyFilters.length ? ` AND ${legacyFilters.join(' AND ')}` : '';
  return db.raw(
    `(COALESCE((SELECT SUM(CASE WHEN co.kind = 'retain' THEN co.amount
    WHEN co.kind IN ('release', 'refund') AND cf.kind = 'retain' THEN -co.amount ELSE 0 END)
    FROM security_charge_operations co
    LEFT JOIN security_charge_operations cf ON cf.id = co.funding_operation_id
    WHERE co.order_id = ${orderRef}${operationScope}), 0)
    + COALESCE((SELECT SUM(sc.amount) FROM security_charges sc
      WHERE sc.order_id = ${orderRef} AND sc.money_flow_version IS NULL AND sc.status <> 'void'
      AND (sc.funding_source = 'security_retained' OR (sc.funding_source IS NULL AND sc.source = 'return_modal'))${legacyScope}), 0))`,
    [...operationBindings, ...legacyBindings]
  );
}
