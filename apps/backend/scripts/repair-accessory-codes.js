import knex from '../src/db/knex.js';
import { ensureAccessoryCodesReady } from '../src/modules/accessories/accessoryCode.js';

const shops = await knex('accessories').distinct('shop_id').pluck('shop_id');
for (const shopId of shops) {
  const n = await ensureAccessoryCodesReady(shopId);
  console.log('shop', shopId.slice(0, 8), 'backfilled', n);
}

const hasCol = await knex.schema.hasColumn('accessories', 'code');
const empty = await knex('accessories').modify((qb) => {
  qb.whereNull('code').orWhere('code', '');
}).count('* as c').first();

const dupes = await knex('accessories')
  .whereNotNull('code')
  .whereNot('code', '')
  .groupBy('shop_id', 'code')
  .havingRaw('COUNT(*) > 1')
  .count('* as c');

const sample = await knex('accessories').select('shop_id', 'name', 'code').limit(8);
console.log(JSON.stringify({ hasCol, empty: empty.c, dupGroups: dupes.length, sample }, null, 2));

await knex.destroy();
