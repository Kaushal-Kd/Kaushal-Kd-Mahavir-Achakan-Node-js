/**
 * Build/refresh local visual-search fingerprints for accessory photos.
 *   node scripts/index-accessory-images.mjs            # all shops
 *   node scripts/index-accessory-images.mjs <shopId>   # one shop
 */
import knex from '../src/db/knex.js';
import { indexAccessoryImages } from '../src/modules/accessories/visualSearchService.js';

const shopId = process.argv[2] || undefined;
const started = Date.now();
const result = await indexAccessoryImages({ shopId });
console.log(JSON.stringify({ ...result, seconds: Math.round((Date.now() - started) / 1000) }));
await knex.destroy();
process.exit(0);
