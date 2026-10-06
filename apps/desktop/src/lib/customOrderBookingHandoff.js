import { customOrderHasLinkedProduct, isIndianPhone, normalizePhone } from '@wrs/shared';

import { customersApi } from './api/customers.js';
import { customOrdersApi } from './api/customOrders.js';
import {
  CUSTOM_ORDER_BOOKING_HANDOFF_KEY,
  bookingDateTimeForConvert,
  buildCustomOrderBookingHandoff,
  buildMeasurementsSummary,
  shouldOfferBookingAfterComplete,
} from './customOrderBookingHandoffPayload.js';

export {
  CUSTOM_ORDER_BOOKING_HANDOFF_KEY,
  bookingDateTimeForConvert,
  buildCustomOrderBookingHandoff,
  buildMeasurementsSummary,
  shouldOfferBookingAfterComplete,
};

/** @returns {boolean} */
export function isCustomOrderBookingHandoffActive() {
  const handoff = readCustomOrderBookingHandoff();
  return Boolean(handoff?.custom_order_id);
}

/**
 * @param {object} order
 * @param {import('react-router-dom').NavigateFunction} navigate
 * @param {{ measurementsSummary?: string, fieldDefs?: object[] }} [options]
 * @returns {boolean}
 */
export function startCustomOrderBookingHandoff(order, navigate, options = {}) {
  if (!customOrderHasLinkedProduct(order)) return false;
  if (order.linked_order_id) return false;
  const summary =
    options.measurementsSummary ??
    buildMeasurementsSummary(order, options.fieldDefs || []);
  writeCustomOrderBookingHandoff(buildCustomOrderBookingHandoff(order, summary));
  navigate('/booking/new', { state: { fromCustomOrder: true } });
  return true;
}

/** @returns {object|null} */
export function readCustomOrderBookingHandoff() {
  try {
    const raw = sessionStorage.getItem(CUSTOM_ORDER_BOOKING_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {object} payload */
export function writeCustomOrderBookingHandoff(payload) {
  sessionStorage.setItem(CUSTOM_ORDER_BOOKING_HANDOFF_KEY, JSON.stringify(payload));
}

export function clearCustomOrderBookingHandoff() {
  try {
    sessionStorage.removeItem(CUSTOM_ORDER_BOOKING_HANDOFF_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Find or create a master customer from a custom-order handoff snapshot.
 * @param {object} c Handoff customer snapshot
 * @returns {Promise<{ customer: object, created: boolean }|null>}
 */
export async function resolveHandoffCustomer(c) {
  if (c?.id) {
    return {
      customer: {
        id: c.id,
        name: c.name || '',
        phone1: c.phone1 || '',
        phone2: c.phone2 || '',
        phone2_name: c.phone2_name || '',
        whatsapp: c.whatsapp || '',
        address: c.address || '',
      },
      created: false,
    };
  }

  const name = String(c?.name || '').trim();
  const phone1 = normalizePhone(c?.phone1 || '');
  const phone2 = normalizePhone(c?.phone2 || '') || null;
  const hasPhone = isIndianPhone(phone1);
  const hasName = name.length >= 1;

  if (!hasPhone && !hasName) return null;

  const searchTerm = hasPhone ? phone1 : name;
  if (searchTerm.length >= 2) {
    try {
      const res = await customersApi.search(searchTerm);
      const rows = res?.data || [];
      if (hasPhone) {
        const exact = rows.find((row) => normalizePhone(row.phone1 || '') === phone1);
        if (exact) return { customer: exact, created: false };
      } else {
        const exactName = rows.find(
          (row) => String(row.name || '').trim().toLowerCase() === name.toLowerCase()
        );
        if (exactName) return { customer: exactName, created: false };
      }
    } catch {
      /* continue to create */
    }
  }

  try {
    if (hasPhone) {
      const res = await customersApi.create({
        name: name || 'Customer',
        phone1,
        phone2,
        phone2_name: c?.phone2_name?.trim() || null,
        whatsapp: c?.whatsapp ? normalizePhone(c.whatsapp) || null : null,
        address: c?.address?.trim() || null,
        is_active: true,
      });
      const customer = res?.data || null;
      return customer ? { customer, created: true } : null;
    }

    const res = await customersApi.quickAvailabilityCreate({ name, phone1: '' });
    let customer = res?.data || null;
    if (!customer) return null;

    const patch = {};
    if (c?.address?.trim()) patch.address = c.address.trim();
    if (phone2) patch.phone2 = phone2;
    if (c?.phone2_name?.trim()) patch.phone2_name = c.phone2_name.trim();
    const whatsapp = c?.whatsapp ? normalizePhone(c.whatsapp) : '';
    if (whatsapp && isIndianPhone(whatsapp)) patch.whatsapp = whatsapp;

    if (Object.keys(patch).length > 0) {
      try {
        const updated = await customersApi.update(customer.id, patch);
        customer = updated?.data || customer;
      } catch {
        /* keep base customer */
      }
    }

    return { customer, created: true };
  } catch (err) {
    const status = err?.response?.status;
    const msg = String(err?.message || '').toLowerCase();
    const isConflict = status === 409 || msg.includes('already exists');
    if (hasPhone && isConflict) {
      try {
        const res = await customersApi.search(phone1);
        const exact = (res?.data || []).find((row) => normalizePhone(row.phone1 || '') === phone1);
        if (exact) return { customer: exact, created: false };
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}

/**
 * @param {string} customOrderId
 * @param {string} customerId
 */
export function linkHandoffCustomerToCustomOrder(customOrderId, customerId) {
  if (!customOrderId || !customerId) return;
  customOrdersApi.update(customOrderId, { customer_id: customerId }).catch(() => {
    /* fire-and-forget */
  });
}
