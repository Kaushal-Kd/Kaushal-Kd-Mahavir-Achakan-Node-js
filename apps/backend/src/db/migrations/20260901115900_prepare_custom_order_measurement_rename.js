import { prepareCustomOrderMeasurementRename } from '../customOrderMeasurementRepair.js';

export const requiresExplicitRun = true;

export async function up(knex) {
  await prepareCustomOrderMeasurementRename(knex);
}

export async function down() {
  // Keep recovery snapshots: dropping them would erase original pre-conversion values.
}
