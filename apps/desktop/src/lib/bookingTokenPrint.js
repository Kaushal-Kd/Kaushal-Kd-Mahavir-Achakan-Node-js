import { toast } from '../stores/uiStore.js';
import { getDefaultBillTemplate } from '../utils/printBill.js';

import {
  buildAccessoryTokenSlipTarget,
  buildProductTokenSlipTargets,
  enrichSlipOrderForTokens,
} from './deliverySlipFormat.js';

function tokenPdfFilename(order, suffix) {
  const raw = String(order?.order_number || order?.bill_no || order?.id || 'booking').trim();
  const safe = raw.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_') || 'booking';
  return `tokens_${safe}_${suffix}.pdf`;
}

function resolveTokenTargets(order) {
  if (!order) {
    return { enriched: enrichSlipOrderForTokens(order), productTargets: [], accessoryTarget: null };
  }
  const enriched = enrichSlipOrderForTokens(order);
  const productTargets = buildProductTokenSlipTargets([enriched]);
  const accessoryTarget = buildAccessoryTokenSlipTarget(order);
  return { enriched, productTargets, accessoryTarget };
}

async function getTokenLayout() {
  const template = await getDefaultBillTemplate();
  const settings = template?.page_settings || {};
  return {
    widthMm: settings.token_width_mm,
    heightMm: settings.token_height_mm,
    minHeightMm: settings.token_min_height_mm,
    fontSize: settings.token_font_size,
    pageMarginMm: settings.token_page_margin_mm,
  };
}

/**
 * @param {object} order — full order from ordersApi.get / create response
 * @returns {{ hasProduct: boolean, hasAccessory: boolean }}
 */
export function getBookingTokenAvailability(order) {
  const { productTargets, accessoryTarget } = resolveTokenTargets(order);
  return {
    hasProduct: productTargets.length > 0,
    hasAccessory: Boolean(accessoryTarget),
  };
}

export function getBookingProductTokenOptions(order) {
  const { productTargets } = resolveTokenTargets(order);
  return productTargets.map((target) => {
    const item = target.items[0] || {};
    const code = String(item.code_snapshot || '').trim();
    const name = String(item.name_snapshot || '').trim();
    return {
      id: item.id,
      label: [code, name].filter(Boolean).join(' — ') || 'Unnamed product',
    };
  });
}

/**
 * @param {object} order — full order from ordersApi.get
 */
export async function printBookingProductTokens(order, selectedItemIds = null) {
  const { productTargets: allProductTargets } = resolveTokenTargets(order);
  const selected = Array.isArray(selectedItemIds) ? new Set(selectedItemIds.map(String)) : null;
  const productTargets = selected
    ? allProductTargets.filter((target) => selected.has(String(target.items[0]?.id || '')))
    : allProductTargets;
  if (!productTargets.length) {
    toast.warning('No product lines to print');
    return;
  }
  const { printDeliverySlipPdf } = await import('../utils/deliverySlipPdf.js');
  await printDeliverySlipPdf(productTargets, 'Booking — Product tokens', await getTokenLayout());
  toast.success('Opening product tokens…');
}

/**
 * @param {object} order — full order from ordersApi.get
 */
export async function printBookingAccessoryTokens(order) {
  const { accessoryTarget } = resolveTokenTargets(order);
  if (!accessoryTarget) {
    toast.warning('No pack-with-rent accessories to print');
    return;
  }
  const { printAccessoryTokenSlipPdf } = await import('../utils/deliverySlipPdf.js');
  await printAccessoryTokenSlipPdf(
    accessoryTarget,
    'Booking — Accessory token',
    await getTokenLayout()
  );
  toast.success('Opening accessory token…');
}

/**
 * @param {object} order — full order from ordersApi.get / create response
 */
export async function downloadBookingProductTokens(order) {
  const { productTargets } = resolveTokenTargets(order);
  if (!productTargets.length) {
    toast.warning('No product lines to download');
    return;
  }
  const { downloadDeliverySlipPdf } = await import('../utils/deliverySlipPdf.js');
  await downloadDeliverySlipPdf(
    tokenPdfFilename(order, 'product'),
    productTargets,
    await getTokenLayout()
  );
  toast.success('Product tokens downloaded');
}

/**
 * @param {object} order — full order from ordersApi.get / create response
 */
export async function downloadBookingAccessoryTokens(order) {
  const { accessoryTarget } = resolveTokenTargets(order);
  if (!accessoryTarget) {
    toast.warning('No pack-with-rent accessories to download');
    return;
  }
  const { downloadAccessoryTokenSlipPdf } = await import('../utils/deliverySlipPdf.js');
  await downloadAccessoryTokenSlipPdf(
    tokenPdfFilename(order, 'accessory'),
    accessoryTarget,
    await getTokenLayout()
  );
  toast.success('Accessory token downloaded');
}

/**
 * @param {object} order — full order from ordersApi.get / create response
 */
export async function downloadBookingBothTokens(order) {
  const { productTargets, accessoryTarget } = resolveTokenTargets(order);
  const combined = accessoryTarget ? [...productTargets, accessoryTarget] : [...productTargets];
  if (!combined.length) {
    toast.warning('No tokens to download');
    return;
  }
  const { downloadDeliverySlipPdf } = await import('../utils/deliverySlipPdf.js');
  await downloadDeliverySlipPdf(tokenPdfFilename(order, 'all'), combined, await getTokenLayout());
  toast.success('Tokens downloaded');
}
