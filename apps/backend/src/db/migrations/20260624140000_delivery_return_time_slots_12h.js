/** Convert time_slots.time_value and orders delivery/return times to 12h h:mm AM/PM. */

/** @param {string|null|undefined} stored */
function to12Hour(stored) {
  const raw = String(stored ?? '').trim();
  if (!raw) return null;
  if (/^(?:[01]?[0-9]|1[0-2]):[0-5]\d (AM|PM)$/i.test(raw)) {
    const m = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return raw;
    return `${Number(m[1])}:${m[2]} ${m[3].toUpperCase()}`;
  }
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return raw;
  let h = Number(m[1]);
  const min = m[2];
  if (!Number.isFinite(h)) return raw;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${min} ${period}`;
}

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  if (await knex.schema.hasTable('time_slots')) {
    await knex.schema.alterTable('time_slots', (t) => {
      t.string('time_value', 12).notNullable().alter();
    });
    const slots = await knex('time_slots').select('id', 'time_value');
    for (const row of slots) {
      const next = to12Hour(row.time_value);
      if (next && next !== row.time_value) {
        await knex('time_slots').where({ id: row.id }).update({ time_value: next });
      }
    }
  }

  const hasDelivery = await knex.schema.hasColumn('orders', 'delivery_time');
  const hasReturn = await knex.schema.hasColumn('orders', 'return_time');
  if (hasDelivery || hasReturn) {
    await knex.schema.alterTable('orders', (t) => {
      if (hasDelivery) t.string('delivery_time', 12).nullable().alter();
      if (hasReturn) t.string('return_time', 12).nullable().alter();
    });
    const orders = await knex('orders')
      .select('id', 'delivery_time', 'return_time')
      .where(function whereTimes() {
        this.whereNotNull('delivery_time').orWhereNotNull('return_time');
      });
    for (const row of orders) {
      const patch = {};
      if (row.delivery_time) {
        const next = to12Hour(row.delivery_time);
        if (next && next !== row.delivery_time) patch.delivery_time = next;
      }
      if (row.return_time) {
        const next = to12Hour(row.return_time);
        if (next && next !== row.return_time) patch.return_time = next;
      }
      if (Object.keys(patch).length) {
        await knex('orders').where({ id: row.id }).update(patch);
      }
    }
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const from12 = (raw) => {
    const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return raw;
    let h = Number(m[1]);
    const min = m[2];
    const period = m[3].toUpperCase();
    if (period === 'AM' && h === 12) h = 0;
    else if (period === 'PM' && h !== 12) h += 12;
    return `${String(h).padStart(2, '0')}:${min}`;
  };

  if (await knex.schema.hasTable('time_slots')) {
    const slots = await knex('time_slots').select('id', 'time_value');
    for (const row of slots) {
      const t24 = from12(row.time_value);
      if (t24 && t24 !== row.time_value) {
        await knex('time_slots').where({ id: row.id }).update({ time_value: t24 });
      }
    }
    await knex.schema.alterTable('time_slots', (t) => {
      t.string('time_value', 5).notNullable().alter();
    });
  }

  const hasDelivery = await knex.schema.hasColumn('orders', 'delivery_time');
  const hasReturn = await knex.schema.hasColumn('orders', 'return_time');
  if (hasDelivery || hasReturn) {
    const orders = await knex('orders')
      .select('id', 'delivery_time', 'return_time')
      .where(function whereTimes() {
        this.whereNotNull('delivery_time').orWhereNotNull('return_time');
      });
    for (const row of orders) {
      const patch = {};
      if (row.delivery_time) patch.delivery_time = from12(row.delivery_time);
      if (row.return_time) patch.return_time = from12(row.return_time);
      if (Object.keys(patch).length) await knex('orders').where({ id: row.id }).update(patch);
    }
    await knex.schema.alterTable('orders', (t) => {
      if (hasDelivery) t.string('delivery_time', 5).nullable().alter();
      if (hasReturn) t.string('return_time', 5).nullable().alter();
    });
  }
}
