import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/errors.js';

/** @param {object} row */
function mapFieldRow(row) {
  if (!row) return row;
  return {
    ...row,
    required: !!row.required,
    is_active: !!row.is_active,
    sort_order: Number(row.sort_order) || 0,
  };
}

export async function listCustomOrderFieldDefinitions(shopId, { includeInactive = false } = {}) {
  const q = knex('custom_order_field_definitions').where({ shop_id: shopId });
  if (!includeInactive) q.where({ is_active: true });
  const rows = await q.orderBy('sort_order', 'asc').orderBy('label', 'asc');
  return rows.map(mapFieldRow);
}

export async function getCustomOrderFieldDefinition(shopId, id) {
  const row = await knex('custom_order_field_definitions')
    .where({ shop_id: shopId, id })
    .first();
  if (!row) throw notFound('Field definition not found');
  return mapFieldRow(row);
}

export async function createCustomOrderFieldDefinition(shopId, body) {
  const label = String(body.label || '').trim();
  const exists = await knex('custom_order_field_definitions')
    .where({ shop_id: shopId, label })
    .first();
  if (exists) throw badRequest('A field with this label already exists');

  const id = uuid();
  const sortOrder =
    body.sort_order != null
      ? Number(body.sort_order)
      : Number(
          (
            await knex('custom_order_field_definitions')
              .where({ shop_id: shopId })
              .max('sort_order as m')
              .first()
          )?.m || 0
        ) + 1;

  await knex('custom_order_field_definitions').insert({
    id,
    shop_id: shopId,
    label,
    field_type: body.field_type || 'number',
    unit: body.unit || null,
    required: !!body.required,
    sort_order: sortOrder,
    is_active: body.is_active !== false,
  });

  return getCustomOrderFieldDefinition(shopId, id);
}

export async function updateCustomOrderFieldDefinition(shopId, id, body) {
  await getCustomOrderFieldDefinition(shopId, id);

  if (body.label != null) {
    const label = String(body.label || '').trim();
    const clash = await knex('custom_order_field_definitions')
      .where({ shop_id: shopId, label })
      .whereNot('id', id)
      .first();
    if (clash) throw badRequest('A field with this label already exists');
    body.label = label;
  }

  const patch = {
    ...(body.label != null ? { label: body.label } : {}),
    ...(body.field_type != null ? { field_type: body.field_type } : {}),
    ...(body.unit !== undefined ? { unit: body.unit || null } : {}),
    ...(body.required != null ? { required: !!body.required } : {}),
    ...(body.sort_order != null ? { sort_order: Number(body.sort_order) } : {}),
    ...(body.is_active != null ? { is_active: !!body.is_active } : {}),
    updated_at: knex.fn.now(),
  };

  await knex('custom_order_field_definitions').where({ shop_id: shopId, id }).update(patch);
  return getCustomOrderFieldDefinition(shopId, id);
}

export async function deactivateCustomOrderFieldDefinition(shopId, id) {
  return updateCustomOrderFieldDefinition(shopId, id, { is_active: false });
}

export async function reorderCustomOrderFieldDefinitions(shopId, orderedIds) {
  const ids = orderedIds.map(String);
  const rows = await knex('custom_order_field_definitions')
    .where({ shop_id: shopId })
    .whereIn('id', ids);
  if (rows.length !== ids.length) throw badRequest('Invalid field id in reorder list');

  await knex.transaction(async (trx) => {
    for (let i = 0; i < ids.length; i += 1) {
      await trx('custom_order_field_definitions')
        .where({ shop_id: shopId, id: ids[i] })
        .update({ sort_order: i, updated_at: trx.fn.now() });
    }
  });

  return listCustomOrderFieldDefinitions(shopId, { includeInactive: true });
}
