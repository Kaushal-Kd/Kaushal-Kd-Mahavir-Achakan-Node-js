import { classifyProductSearchTerm, normalizeProductCode, productCodeDigitsKey } from '@wrs/shared';

function escapeLikeTerm(value) {
  return String(value ?? '').replace(/[%_\\]/g, '\\$&');
}

function likePattern(value) {
  const escaped = escapeLikeTerm(value);
  return escaped ? `%${escaped}%` : '%';
}

/** Digit sequence with leading zeros trimmed so `0795` and `795` match. */
function trimLeadingZeros(digits) {
  return String(digits ?? '').replace(/^0+(?=\d)/, '');
}

/**
 * Loose product text search: name, code, design details (stored as notes), color, size.
 * Digit-only input matches numeric segments in code across all prefixes.
 * Letter-led input (A-, A-506) matches code prefix strictly — no cross-series digit OR.
 * @param {import('knex').Knex.QueryBuilder} qb
 * @param {string} rawSearch
 * @param {string} [alias]
 */
export function applyProductSearchFilter(qb, rawSearch, alias = 'p') {
  const term = String(rawSearch || '').trim();
  if (!term) return qb;

  const classified = classifyProductSearchTerm(term);
  if (classified.mode === 'none') return qb;

  const nameCol = `${alias}.name`;
  const codeCol = `${alias}.code`;
  const colorCol = `${alias}.color`;
  const sizeCol = `${alias}.size`;
  const notesCol = `${alias}.notes`;
  const likeAny = likePattern(term);
  const compactCodeExpr = `REPLACE(REPLACE(${codeCol}, ' ', ''), '-', '')`;
  const baseCodeExpr = `CASE WHEN ${codeCol} LIKE '%]%' THEN SUBSTRING_INDEX(${codeCol}, '[', 1) ELSE ${codeCol} END`;
  const compactBaseCodeExpr = `REPLACE(REPLACE(${baseCodeExpr}, ' ', ''), '-', '')`;

  const matchName = (q) => q.orWhereRaw(`LOWER(${nameCol}) LIKE LOWER(?)`, [likeAny]);
  const matchDesignDetails = (q) =>
    q.orWhereRaw(`LOWER(COALESCE(${notesCol}, '')) LIKE LOWER(?)`, [likeAny]);
  const matchCodeContains = (q) => {
    q.orWhereRaw(`LOWER(${codeCol}) LIKE LOWER(?)`, [likeAny])
      .orWhereRaw(`LOWER(${baseCodeExpr}) LIKE LOWER(?)`, [likeAny])
      .orWhereRaw(`LOWER(${compactCodeExpr}) LIKE LOWER(?)`, [likeAny])
      .orWhereRaw(`LOWER(${compactBaseCodeExpr}) LIKE LOWER(?)`, [likeAny]);
  };
  /** Numeric-only input — never use single-digit trimmed variants (e.g. `%5%` from `05`). */
  const matchDigitOnlyCode = (q, digits) => {
    if (!digits) return;
    const patterns = [likePattern(digits)];
    const trimmed = trimLeadingZeros(digits);
    if (trimmed && trimmed !== digits && trimmed.length >= 2) {
      patterns.push(likePattern(trimmed));
    }
    for (const pattern of patterns) {
      q.orWhere(codeCol, 'like', pattern)
        .orWhereRaw(`${compactCodeExpr} LIKE ?`, [pattern])
        .orWhereRaw(`${compactBaseCodeExpr} LIKE ?`, [pattern]);
    }
  };
  /** Same letter series with alternate zero-padding (A-0795 ↔ A-795), prefix-only. */
  const matchPrefixDigitPadding = (q, prefix) => {
    const m = prefix.match(/^([a-z]{1,2})-(\d+)$/);
    if (!m) return;
    const [, letters, digits] = m;
    const trimmed = trimLeadingZeros(digits);
    if (!trimmed || trimmed === digits || trimmed.length < 2) return;
    const altPrefix = `${letters}-${trimmed}`;
    const altCompact = `${letters}${trimmed}`;
    q.orWhereRaw(`LOWER(${codeCol}) LIKE ?`, [`${altPrefix}%`])
      .orWhereRaw(`LOWER(${baseCodeExpr}) LIKE ?`, [`${altPrefix}%`])
      .orWhereRaw(`LOWER(${compactCodeExpr}) LIKE ?`, [`${altCompact}%`])
      .orWhereRaw(`LOWER(${compactBaseCodeExpr}) LIKE ?`, [`${altCompact}%`]);
  };

  if (classified.mode === 'prefix') {
    const prefix = classified.normalizedPrefix;
    const compactPrefix = prefix.replace(/-/g, '');
    qb.andWhere((q) => {
      q.whereRaw('1 = 0')
        .orWhereRaw(`LOWER(${codeCol}) LIKE ?`, [`${prefix}%`])
        .orWhereRaw(`LOWER(${compactCodeExpr}) LIKE ?`, [`${compactPrefix}%`])
        .orWhereRaw(`LOWER(${baseCodeExpr}) LIKE ?`, [`${prefix}%`])
        .orWhereRaw(`LOWER(${compactBaseCodeExpr}) LIKE ?`, [`${compactPrefix}%`]);
      matchPrefixDigitPadding(q, prefix);
      matchDesignDetails(q);
    });
    return qb;
  }

  if (classified.mode === 'digits') {
    qb.andWhere((q) => {
      q.whereRaw('1 = 0');
      matchName(q);
      matchDesignDetails(q);
      matchCodeContains(q);
      q.orWhere(colorCol, 'like', likeAny).orWhere(sizeCol, 'like', likeAny);
      matchDigitOnlyCode(q, classified.term);
    });
    return qb;
  }

  qb.andWhere((q) => {
    q.whereRaw('1 = 0');
    matchName(q);
    matchDesignDetails(q);
    matchCodeContains(q);
    q.orWhere(colorCol, 'like', likeAny).orWhere(sizeCol, 'like', likeAny);
  });
  return qb;
}

/**
 * Best matches first: exact code, prefix, compact code, substring, then name.
 * @param {import('knex').Knex.QueryBuilder} qb
 * @param {string} rawSearch
 * @param {string} [alias]
 */
export function applyProductSearchRanking(qb, rawSearch, alias = 'p') {
  const term = String(rawSearch || '').trim();
  if (!term) return qb;

  const classified = classifyProductSearchTerm(term);
  const codeCol = `${alias}.code`;
  const nameCol = `${alias}.name`;
  const notesCol = `${alias}.notes`;
  const compactCodeExpr = `REPLACE(REPLACE(${codeCol}, ' ', ''), '-', '')`;

  if (classified.mode === 'prefix') {
    const prefix = classified.normalizedPrefix;
    const compactPrefix = prefix.replace(/-/g, '');
    qb.orderByRaw(
      `CASE
        WHEN LOWER(${codeCol}) = ? THEN 0
        WHEN LOWER(${codeCol}) LIKE ? THEN 1
        WHEN LOWER(${compactCodeExpr}) LIKE ? THEN 2
        WHEN LOWER(${nameCol}) LIKE LOWER(?) THEN 3
        WHEN LOWER(COALESCE(${notesCol}, '')) LIKE LOWER(?) THEN 4
        ELSE 5
      END, ${nameCol} ASC`,
      [prefix, `${prefix}%`, `${compactPrefix}%`, likePattern(term), likePattern(term)]
    );
    return qb;
  }

  const compact = term.replace(/[\s-]/g, '');
  const termLike = likePattern(term);
  const compactLike = likePattern(compact);
  qb.orderByRaw(
    `CASE
      WHEN ${codeCol} = ? THEN 0
      WHEN LOWER(${codeCol}) = LOWER(?) THEN 1
      WHEN ${codeCol} LIKE ? THEN 2
      WHEN LOWER(${compactCodeExpr}) LIKE LOWER(?) THEN 3
      WHEN ${codeCol} LIKE ? THEN 4
      WHEN LOWER(${nameCol}) LIKE LOWER(?) THEN 5
      WHEN LOWER(COALESCE(${notesCol}, '')) LIKE LOWER(?) THEN 6
      ELSE 7
    END, ${nameCol} ASC`,
    [term, term, `${escapeLikeTerm(term)}%`, compactLike, termLike, termLike, termLike]
  );
  return qb;
}

/**
 * Resolve a product from full/partial code or name-like input.
 * @param {import('knex').Knex} db
 * @param {string} shopId
 * @param {string} rawCode
 * @param {{ activeOnly?: boolean }} [opts]
 */
export async function findProductByCodeOrSearch(db, shopId, rawCode, opts = {}) {
  const activeOnly = opts.activeOnly !== false;
  const term = String(rawCode || '').trim();
  if (!term) return null;

  const classified = classifyProductSearchTerm(term);

  const base = () => {
    let qb = db('products as p').where({ 'p.shop_id': shopId });
    if (activeOnly) qb = qb.andWhere({ 'p.is_active': true });
    return qb;
  };

  const exact = await base().andWhere({ 'p.code': term }).select('p.*').first();
  if (exact) return exact;

  const exactCi = await base().whereRaw('LOWER(p.code) = LOWER(?)', [term]).select('p.*').first();
  if (exactCi) return exactCi;

  const compact = normalizeProductCode(term).replace(/-/g, '');
  if (compact) {
    const compactMatch = await base()
      .whereRaw(`REPLACE(REPLACE(p.code, ' ', ''), '-', '') = ?`, [compact])
      .select('p.*')
      .first();
    if (compactMatch) return compactMatch;
  }

  const qb = base().select('p.*');
  applyProductSearchFilter(qb, term, 'p');
  applyProductSearchRanking(qb, term, 'p');
  const matches = await qb.limit(15);

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Digit-normalized exact match handles padding differences (A-0795 vs A-795).
  const termDigitsKey = productCodeDigitsKey(term);
  if (termDigitsKey) {
    const digitKeyHits = matches.filter((row) => productCodeDigitsKey(row.code) === termDigitsKey);
    if (digitKeyHits.length === 1) return digitKeyHits[0];
  }

  if (classified.mode === 'digits') {
    const digitHits = matches.filter((row) => {
      const code = normalizeProductCode(row.code);
      return code.includes(term) || code.replace(/[^\d]/g, '').includes(term);
    });
    if (digitHits.length === 1) return digitHits[0];
  }

  if (classified.mode === 'prefix') {
    const prefix = classified.normalizedPrefix;
    const prefixHits = matches.filter((row) => {
      const code = normalizeProductCode(row.code).toLowerCase();
      return code.startsWith(prefix) || code.replace(/-/g, '').startsWith(prefix.replace(/-/g, ''));
    });
    if (prefixHits.length === 1) return prefixHits[0];
    if (prefixHits.length > 0) return prefixHits[0];
  }

  const normalizedTerm = normalizeProductCode(term).toLowerCase();
  const normalizedHits = matches.filter(
    (row) => normalizeProductCode(row.code).toLowerCase() === normalizedTerm
  );
  if (normalizedHits.length === 1) return normalizedHits[0];

  return matches[0];
}
