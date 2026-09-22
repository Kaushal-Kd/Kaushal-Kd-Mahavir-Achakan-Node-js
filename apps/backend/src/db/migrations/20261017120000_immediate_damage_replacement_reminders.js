import { replacementReminderSchedule, todayIndiaISODate } from '@wrs/shared';

export async function up(knex) {
  const today = todayIndiaISODate();
  const schedule = replacementReminderSchedule(today);
  const pending = await knex('order_item_replacement_requirements as rr')
    .join('reminders as r', 'r.id', 'rr.reminder_id')
    .where('rr.status', 'pending')
    .andWhere('r.is_completed', false)
    .select('r.id');
  const ids = pending.map((row) => row.id).filter(Boolean);
  if (!ids.length) return;
  await knex('reminders').whereIn('id', ids).update({
    reminder_date: schedule.reminder_date,
    reminder_time: schedule.reminder_time,
  });
}

export async function down() {
  // Existing pending reminders stay immediate; original pickup-minus-one dates cannot be restored.
}
