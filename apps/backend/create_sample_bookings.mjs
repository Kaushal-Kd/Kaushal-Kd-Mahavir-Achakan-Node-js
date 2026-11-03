import { v4 as uuid } from 'uuid';
import knex from './src/db/knex.js';

async function createSampleBookings() {
  try {
    console.log('📋 Creating sample bookings for Mahavir Achakan...\n');

    // Find Mahavir Achakan shop
    const shop = await knex('shops')
      .where('shop_name', 'LIKE', '%Mahavir%')
      .first();

    if (!shop) {
      console.error('❌ Shop not found');
      process.exit(1);
    }
    console.log(`✅ Found shop: ${shop.shop_name} (${shop.id})`);

    // Find Mehul Nimay user
    const mehul = await knex('users')
      .where('name', 'LIKE', '%MEHUL%')
      .first();

    if (!mehul) {
      console.error('❌ Salesman "MEHUL NIMAY" not found. Please create this user first.');
      process.exit(1);
    }
    console.log(`✅ Found salesman: ${mehul.name} (${mehul.id})\n`);

    // Get some products from the shop
    const products = await knex('products')
      .where('shop_id', shop.id)
      .limit(5);

    if (products.length === 0) {
      console.error('❌ No products found in shop');
      process.exit(1);
    }
    console.log(`✅ Found ${products.length} products in shop`);

    // Create a customer
    const customerId = uuid();
    await knex('customers').insert({
      id: customerId,
      shop_id: shop.id,
      name: 'Demo Customer',
      phone1: '9999999999',
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log(`✅ Created demo customer`);

    // Create a booking for November 2026
    const orderId = uuid();
    const bookingDate = '2026-11-15'; // Mid-November

    // Get next bill_no
    const billResult = await knex('orders')
      .where('shop_id', shop.id)
      .max('bill_no', { as: 'max_bill' })
      .first();
    const billNo = (billResult?.max_bill || 0) + 1;

    await knex('orders').insert({
      id: orderId,
      shop_id: shop.id,
      bill_no: billNo,
      order_number: `ORD-${billNo}`,
      order_type: 'rent',
      booking_date: bookingDate,
      pickup_date: bookingDate,
      return_date: '2026-11-22',
      status: 'confirmed',
      pickup_name: 'Demo Customer',
      pickup_number: '9999999999',
      customer_id: customerId,
      sales_person_id: mehul.id,
      subtotal: 10000,
      total_amount: 10000,
      paid_amount: 5000,
      balance: 5000,
      booking_discount_amount: 0,
      payment_status: 'partial',
      is_deleted: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log(`✅ Created booking for ${bookingDate} (Bill #${billNo})`);

    // Add order items
    for (let i = 0; i < Math.min(3, products.length); i++) {
      const product = products[i];
      const itemId = uuid();

      await knex('order_items').insert({
        id: itemId,
        order_id: orderId,
        shop_id: shop.id,
        product_id: product.id,
        sales_person_id: mehul.id,
        qty: 1,
        price: 5000,
        discount: 0,
        type: 'rent',
        condition: 'fresh',
        name_snapshot: product.name,
        code_snapshot: product.code,
        line_total: 5000,
        created_at: new Date(),
        updated_at: new Date(),
      });
      console.log(`   └─ Added item: ${product.name}`);
    }

    console.log(`\n✅ Sample bookings created successfully!`);
    console.log(`   You can now view the Salesman Report for ${mehul.name} in November 2026.`);

    await knex.destroy();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await knex.destroy();
    process.exit(1);
  }
}

createSampleBookings();
