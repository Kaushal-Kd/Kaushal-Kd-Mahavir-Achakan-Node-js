import { notFound } from '../../utils/errors.js';

/** Order first, then sorted inventory: shared by return, delivery and replacement commands. */
export async function lockOrderInventory(trx, shopId, orderId, incoming = []) {
  let items = [];
  let accessories = [];
  if (orderId) {
    const order = await trx('orders')
      .where({ id: orderId, shop_id: shopId })
      .forUpdate()
      .first('id');
    if (!order) throw notFound('Order not found');
    items = await trx('order_items')
      .where({ order_id: orderId, shop_id: shopId })
      .select('product_id');
    accessories = await trx('order_accessories')
      .where({ order_id: orderId, shop_id: shopId })
      .select('accessory_id');
  }
  const productIds = [
    ...new Set([...items, ...incoming].map((row) => row.product_id).filter(Boolean)),
  ].sort();
  const accessoryIds = [
    ...new Set([...accessories, ...incoming].map((row) => row.accessory_id).filter(Boolean)),
  ].sort();
  if (productIds.length)
    await trx('products')
      .where({ shop_id: shopId })
      .whereIn('id', productIds)
      .orderBy('id')
      .forUpdate()
      .select('id');
  if (accessoryIds.length)
    await trx('accessories')
      .where({ shop_id: shopId })
      .whereIn('id', accessoryIds)
      .orderBy('id')
      .forUpdate()
      .select('id');
}
