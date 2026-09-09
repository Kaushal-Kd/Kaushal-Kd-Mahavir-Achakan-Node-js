import { restoreCustomOrderMeasurements } from '../customOrderMeasurementRepair.js';

export const requiresExplicitRun = true;

export async function up(knex) {
  await restoreCustomOrderMeasurements(knex);
}

export async function down() {
  // Restoration is lossless and must not be undone by overwriting later business edits.
}
