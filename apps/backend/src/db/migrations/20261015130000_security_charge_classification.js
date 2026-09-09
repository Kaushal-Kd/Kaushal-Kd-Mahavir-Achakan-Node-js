export async function up(knex) {
  const hasConditionKind = await knex.schema.hasColumn('security_charges', 'condition_kind');
  const hasFundingSource = await knex.schema.hasColumn('security_charges', 'funding_source');

  await knex.schema.alterTable('security_charges', (table) => {
    if (!hasConditionKind) table.string('condition_kind', 16).nullable();
    if (!hasFundingSource) table.string('funding_source', 24).nullable();
  });

  await knex('security_charges')
    .where({ source: 'return_modal' })
    .whereNull('funding_source')
    .update({ funding_source: 'security_retained' });

  await knex('security_charges')
    .whereNull('condition_kind')
    .whereRaw("LOWER(TRIM(COALESCE(remarks, ''))) LIKE 'damage ·%'")
    .update({ condition_kind: 'damage' });
  await knex('security_charges')
    .whereNull('condition_kind')
    .whereRaw("LOWER(TRIM(COALESCE(remarks, ''))) LIKE 'missing ·%'")
    .update({ condition_kind: 'missing' });
}

export async function down(knex) {
  const hasConditionKind = await knex.schema.hasColumn('security_charges', 'condition_kind');
  const hasFundingSource = await knex.schema.hasColumn('security_charges', 'funding_source');

  await knex.schema.alterTable('security_charges', (table) => {
    if (hasFundingSource) table.dropColumn('funding_source');
    if (hasConditionKind) table.dropColumn('condition_kind');
  });
}
