/** Convert orders.booking_time from 24h HH:MM to 12h h:mm AM/PM storage. */

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
  const has = await knex.schema.hasColumn('orders', 'booking_time');
  if (!has) return;

  await knex.schema.alterTable('orders', (t) => {
    t.string('booking_time', 12).nullable().alter();
  });

  const rows = await knex('orders').whereNotNull('booking_time').select('id', 'booking_time');
  for (const row of rows) {
    const next = to12Hour(row.booking_time);
    if (next && next !== row.booking_time) {
      await knex('orders').where({ id: row.id }).update({ booking_time: next });
    }
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const has = await knex.schema.hasColumn('orders', 'booking_time');
  if (!has) return;

  const rows = await knex('orders').whereNotNull('booking_time').select('id', 'booking_time');
  for (const row of rows) {
    const raw = String(row.booking_time || '').trim();
    const m = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) continue;
    let h = Number(m[1]);
    const min = m[2];
    const period = m[3].toUpperCase();
    if (period === 'AM' && h === 12) h = 0;
    else if (period === 'PM' && h !== 12) h += 12;
    const t24 = `${String(h).padStart(2, '0')}:${min}`;
    await knex('orders').where({ id: row.id }).update({ booking_time: t24 });
  }

  await knex.schema.alterTable('orders', (t) => {
    t.string('booking_time', 5).nullable().alter();
  });
}
