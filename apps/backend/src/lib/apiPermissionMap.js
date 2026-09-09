import { ACTIONS, hasPermission, MODULES } from '@wrs/shared';

import { forbidden } from '../utils/errors.js';

/** Longest-prefix wins — order matters (more specific first). */
const API_PREFIX_MODULES = [
  ['/api/shop-email-settings', MODULES.SHOPS],
  ['/api/custom-order-fields', MODULES.CUSTOM_ORDERS],
  ['/api/custom-orders', MODULES.CUSTOM_ORDERS],
  ['/api/security-charges', MODULES.SECURITY],
  ['/api/security-accounts', MODULES.ACCOUNTS],
  ['/api/payments/security-transactions', MODULES.SECURITY],
  ['/api/payments/security-due', MODULES.SECURITY],
  ['/api/income-entries', MODULES.INCOME],
  ['/api/expense-entries', MODULES.EXPENSES],
  ['/api/journal-vouchers', MODULES.VOUCHERS],
  ['/api/receipt-vouchers', MODULES.VOUCHERS],
  ['/api/payment-vouchers', MODULES.VOUCHERS],
  ['/api/credit-notes', MODULES.CREDIT_NOTES],
  ['/api/payment-accounts', MODULES.ACCOUNTS],
  ['/api/bill-templates', MODULES.BILL_TEMPLATES],
  ['/api/system-logs', MODULES.AUDIT_LOGS],
  ['/api/washing-queue', MODULES.LAUNDRY],
  ['/api/dashboard', MODULES.DASHBOARD],
  ['/api/configurations', MODULES.SETTINGS],
  ['/api/categories', MODULES.CATEGORIES],
  ['/api/time-slots', MODULES.SETTINGS],
  ['/api/accessories', MODULES.ACCESSORIES],
  ['/api/products', MODULES.PRODUCTS],
  ['/api/orders', MODULES.BOOKING],
  ['/api/customers', MODULES.CUSTOMERS],
  ['/api/payments', MODULES.PAYMENTS],
  ['/api/sales', MODULES.SALES],
  ['/api/purchases', MODULES.PURCHASES],
  ['/api/laundry', MODULES.LAUNDRY],
  ['/api/imports', MODULES.BULK_IMPORT],
  ['/api/ip-whitelist', MODULES.SETTINGS],
  ['/api/gst', MODULES.REPORTS],
  ['/api/reports', MODULES.REPORTS],
  ['/api/reminders', MODULES.SETTINGS],
  ['/api/drafts', MODULES.BOOKING],
  ['/api/uploads', MODULES.PRODUCTS],
  ['/api/whatsapp', MODULES.SETTINGS],
  ['/api/shops', MODULES.SHOPS],
  ['/api/users', MODULES.USERS],
  ['/api/roles', MODULES.SETTINGS],
];

const SKIP_PREFIXES = ['/api/auth', '/health'];

/**
 * @param {string} method
 */
export function httpMethodToAction(method) {
  const m = String(method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return ACTIONS.VIEW;
  if (m === 'POST') return ACTIONS.CREATE;
  if (m === 'PUT' || m === 'PATCH') return ACTIONS.EDIT;
  if (m === 'DELETE') return ACTIONS.DELETE;
  return ACTIONS.VIEW;
}

export function resolveApiAction(path, method) {
  const cleanPath = String(path || '').split('?')[0];
  if (
    String(method || '').toUpperCase() === 'POST' &&
    /^\/api\/gst\/[^/]+\/convert-to-kaccha$/.test(cleanPath)
  ) {
    return ACTIONS.APPROVE;
  }
  if (
    String(method || '').toUpperCase() === 'POST' &&
    /^\/api\/whatsapp\/messages\/(send|resend)$/.test(cleanPath)
  ) {
    return ACTIONS.PRINT;
  }
  if (
    String(method || '').toUpperCase() === 'POST' &&
    /^\/api\/orders\/[^/]+\/((delivery|return)-settlement|checklist-command)$/.test(cleanPath)
  ) {
    return ACTIONS.EDIT;
  }
  return httpMethodToAction(method);
}

/**
 * @param {string} url
 */
export function resolveApiModule(url) {
  const path = String(url || '').split('?')[0];
  if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return null;
  if (!path.startsWith('/api/')) return null;
  if (/^\/api\/whatsapp\/messages\/(send|resend)$/.test(path)) return MODULES.BOOKING;
  for (const [prefix, module] of API_PREFIX_MODULES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return module;
  }
  return null;
}

/**
 * @param {import('fastify').FastifyRequest} request
 */
export function enforceApiPermission(request) {
  const path = request.url.split('?')[0];
  if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return;
  if (!path.startsWith('/api/')) return;
  if (!request.authUser) return;

  const moduleName = resolveApiModule(path);
  if (!moduleName) return;

  const action = resolveApiAction(path, request.method);
  const ok = hasPermission(request.authUser, moduleName, action);
  if (!ok) {
    throw forbidden(`Missing permission: ${moduleName}.${action}`);
  }
}
