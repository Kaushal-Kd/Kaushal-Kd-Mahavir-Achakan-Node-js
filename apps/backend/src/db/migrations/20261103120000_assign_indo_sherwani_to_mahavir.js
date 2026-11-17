export async function up(knex) {
  // Find Mahavir Achakan shop
  const shop = await knex('shops')
    .where('shop_name', 'like', '%Mahavir%')
    .first();

  if (!shop) {
    throw new Error('Shop "Mahavir Achakan" not found. Please create the shop first.');
  }

  console.log(`📦 Assigning SHERWANI/INDO products to shop: ${shop.name} (${shop.id})`);

  // Get current count before update
  const beforeCount = await knex('products')
    .whereRaw("code LIKE 'SHERWANI%' OR code LIKE 'INDO%'")
    .count('* as total')
    .first();

  console.log(`Found ${beforeCount.total} products to assign`);

  // Update all SHERWANI and INDO products to Mahavir Achakan shop
  const updated = await knex('products')
    .whereRaw("code LIKE 'SHERWANI%' OR code LIKE 'INDO%'")
    .update({
      shop_id: shop.id,
      updated_at: knex.fn.now(),
    });

  console.log(`✅ Updated ${updated} products`);

  // Verify
  const afterCount = await knex('products')
    .where('shop_id', shop.id)
    .whereRaw("code LIKE 'SHERWANI%' OR code LIKE 'INDO%'")
    .count('* as total')
    .first();

  console.log(`✓ Verified: ${afterCount.total} products now assigned to ${shop.name}`);
}

export async function down(knex) {
  // This migration sets shop_id, so rolling back would set them to NULL
  // Only rollback if absolutely necessary
  const shop = await knex('shops')
    .where('shop_name', 'like', '%Mahavir%')
    .first();

  if (shop) {
    await knex('products')
      .where('shop_id', shop.id)
      .whereRaw("code LIKE 'SHERWANI%' OR code LIKE 'INDO%'")
      .update({
        shop_id: null,
        updated_at: knex.fn.now(),
      });
    console.log('🔄 Rolled back: Reset SHERWANI/INDO products shop_id to NULL');
  }
}
