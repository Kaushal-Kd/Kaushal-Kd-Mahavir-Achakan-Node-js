/**
 * Apply pagination + search + sort to a Knex query.
 * @param {import('knex').Knex.QueryBuilder} qb
 * @param {{ page?: number, per_page?: number, search?: string, sort?: string, search_fields?: string[] }} params
 */
export async function paginate(qb, params = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const perPage = Math.min(500, Math.max(1, Number(params.per_page) || 50));
  const search = (params.search || '').toString().trim();
  const sort = params.sort || '-created_at';
  const searchFields = params.search_fields || [];

  if (search && searchFields.length > 0) {
    qb.where((b) => {
      for (const f of searchFields) {
        b.orWhere(f, 'like', `%${search}%`);
      }
    });
  }

  if (sort) {
    const tokens = String(sort)
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const token of tokens) {
      const desc = token.startsWith('-');
      const col = desc ? token.slice(1) : token;
      qb.orderBy(col, desc ? 'desc' : 'asc');
    }
  }

  const countQuery = qb.clone().clearSelect().clearOrder().count({ total: '*' }).first();
  const [{ total } = { total: 0 }, rows] = await Promise.all([
    countQuery,
    qb.offset((page - 1) * perPage).limit(perPage),
  ]);

  return {
    data: rows,
    meta: {
      page,
      per_page: perPage,
      total: Number(total || 0),
      total_pages: Math.ceil(Number(total || 0) / perPage) || 0,
    },
  };
}
