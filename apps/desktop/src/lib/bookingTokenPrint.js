import { toast } from '../stores/uiStore.js';

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
  const enriched = enrichSlipOrderForTokens(order);
  const productTargets = buildProductTokenSlipTargets([enriched]);
  const accessoryTarget = buildAccessoryTokenSlipTarget(order);
  return { enriched, productTargets, accessoryTarget };
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

/**
 * @param {object} order — full order from ordersApi.get
 */
export async function printBookingProductTokens(order) {
  const { productTargets } = resolveTokenTargets(order);
  if (!productTargets.length) {
    toast.warning('No product lines to print');
    return;
  }
  const { printDeliverySlipPdf } = await import('../utils/deliverySlipPdf.js');
  await printDeliverySlipPdf(productTargets, 'Booking — Product tokens');
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
  await printAccessoryTokenSlipPdf(accessoryTarget, 'Booking — Accessory token');
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
  await downloadDeliverySlipPdf(tokenPdfFilename(order, 'product'), productTargets);
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
  await downloadAccessoryTokenSlipPdf(tokenPdfFilename(order, 'accessory'), accessoryTarget);
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
  await downloadDeliverySlipPdf(tokenPdfFilename(order, 'all'), combined);
  toast.success('Tokens downloaded');
}
