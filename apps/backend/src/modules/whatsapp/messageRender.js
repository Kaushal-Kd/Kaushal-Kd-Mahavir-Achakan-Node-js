import {
  buildWhatsAppContextFromOrder,
  buildWhatsAppTemplatesFromStored,
  renderWhatsAppTemplate,
  whatsappMessageSettingKey,
} from '@wrs/shared';

import knex from '../../db/knex.js';

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseFlags(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function whatsappOrderItemLabel(row, conditionKind = null) {
  const code = String(row.code_snapshot || '').trim();
  const name = String(row.name_snapshot || '').trim() || 'Item';
  const totalQty = Math.max(1, Number(row.qty || 1));
  const conditionQty = conditionKind ? Number(row[`${conditionKind}_qty`] || 0) : 0;
  const qty = conditionQty > 0 ? Math.min(totalQty, conditionQty) : totalQty;
  const category = String(row.category_name || '').trim();
  return `${category ? `${category} · ` : ''}${code ? `${code} · ` : ''}${name}${qty > 1 ? ` × ${qty}` : ''}`;
}

async function loadShopBillNotesPlain(shopId) {
  const row = await knex('settings').where({ shop_id: shopId, key: 'BILL_NOTES' }).first();
  return htmlToPlainText(row?.value || '');
}

/**
 * Load active template message for a shop and render placeholders.
 * @param {string} shopId
 * @param {string} templateKey
 * @param {Record<string, string | number | null | undefined>} [context]
 */
export async function renderTemplateForShop(shopId, templateKey, context = {}, renderOpts = {}) {
  const rows = await knex('settings')
    .where({ shop_id: shopId })
    .whereIn('key', [whatsappMessageSettingKey(templateKey)]);
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const templates = buildWhatsAppTemplatesFromStored(stored);
  const tpl = templates.find((t) => t.key === templateKey);
  if (!tpl) {
    throw new Error(`Unknown WhatsApp template: ${templateKey}`);
  }
  if (!tpl.is_active) {
    throw new Error(`WhatsApp template "${templateKey}" is inactive`);
  }
  const body = renderWhatsAppTemplate(tpl.message, context, {
    stripBillPdfTokens: !!renderOpts.strip_bill_pdf_token,
  });
  return { body, template: tpl };
}

/**
 * Build render context from order + related rows when order_id is provided.
 * @param {string} shopId
 * @param {string} templateKey
 * @param {{ order_id?: string, context?: Record<string, string> }} opts
 */
export async function renderTemplateWithOrderContext(shopId, templateKey, opts = {}) {
  let context = { ...(opts.context || {}) };
  if (opts.order_id) {
    const order = await knex('orders').where({ id: opts.order_id, shop_id: shopId }).first();
    const shop = await knex('shops').where({ id: shopId }).first();
    let customer = null;
    if (order?.customer_id) {
      customer = await knex('customers').where({ id: order.customer_id }).first();
    }
    const enrichedOrder = { ...(order || {}) };
    if (order?.id) {
      const items = await knex('order_items')
        .where({ order_id: order.id })
        .select('id', 'name_snapshot', 'code_snapshot', 'qty', 'line_total', 'stage_flags', 'missing', 'damaged');
      const accessories = await knex('order_accessories as oa')
        .leftJoin('accessories as a', 'a.id', 'oa.accessory_id')
        .leftJoin('categories as cat', 'cat.id', 'a.category_id')
        .where({ 'oa.order_id': order.id })
        .select(
          'oa.id',
          'oa.accessory_id',
          'oa.name_snapshot',
          'oa.qty',
          'oa.line_total',
          'oa.stage_flags',
          'oa.missing',
          'oa.damaged',
          'oa.missing_qty',
          'oa.damaged_qty',
          'a.code as code_snapshot',
          'cat.label as category_name'
        );
      const lines = [
        ...items.map((r) => {
          const name = r.name_snapshot || r.code_snapshot || 'Item';
          return `${name} x${r.qty || 1}`;
        }),
        ...accessories.map((r) => {
          const name = r.name_snapshot || 'Accessory';
          return `${name} x${r.qty || 1}`;
        }),
      ];
      if (lines.length) {
        enrichedOrder.items_summary = lines.join(', ');
        enrichedOrder.product_name = lines[0] || '';
        enrichedOrder.product_names = lines.join(', ');
      }
      enrichedOrder.grand_total = order.total_amount;
      enrichedOrder.pending_amount = order.balance;
      enrichedOrder.advance_amount = order.paid_amount;
      enrichedOrder.discount = order.discount_total;
      const allLines = [...items, ...accessories];
      enrichedOrder.delivered_items = allLines
        .filter((row) => !!parseFlags(row.stage_flags).delivered)
        .map((row) => whatsappOrderItemLabel(row))
        .join(', ');
      enrichedOrder.pending_delivery_items = allLines
        .filter((row) => !parseFlags(row.stage_flags).delivered)
        .map((row) => whatsappOrderItemLabel(row))
        .join(', ');
      enrichedOrder.missing_items = allLines
        .filter((row) => !!row.missing)
        .map((row) => whatsappOrderItemLabel(row, 'missing'))
        .join(', ');
      enrichedOrder.damage_items = allLines
        .filter((row) => !!row.damaged)
        .map((row) => whatsappOrderItemLabel(row, 'damaged'))
        .join(', ');
      const charges = await knex('security_charges')
        .where({ order_id: order.id })
        .whereNot('status', 'void')
        .whereIn('condition_kind', ['missing', 'damage'])
        .select('condition_kind', 'amount');
      enrichedOrder.missing_charges = charges
        .filter((row) => row.condition_kind === 'missing')
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      enrichedOrder.damage_charges = charges
        .filter((row) => row.condition_kind === 'damage')
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    }
    enrichedOrder.bill_notes = await loadShopBillNotesPlain(shopId);
    context = {
      ...buildWhatsAppContextFromOrder(enrichedOrder, shop || {}, customer || {}),
      ...context,
    };
  } else if (!Object.keys(context).length) {
    const shop = await knex('shops').where({ id: shopId }).first();
    context = buildWhatsAppContextFromOrder({}, shop || {}, {});
  }
  return renderTemplateForShop(shopId, templateKey, context, {
    strip_bill_pdf_token: !!opts.strip_bill_pdf_token,
  });
}
