import { normalizePhone, phoneInputDigits } from '@wrs/shared';

/** @param {unknown} value */
export function normalizeWhatsappSource(value) {
  const v = String(value || '').trim();
  if (v === 'phone2') return 'phone2';
  if (v === 'manual' || v === 'other') return 'manual';
  return 'phone1';
}

/** @param {object|null|undefined} row */
export function inferWhatsappSource(row) {
  const wa = phoneInputDigits(row?.whatsapp);
  const p1 = phoneInputDigits(row?.phone1);
  const p2 = phoneInputDigits(row?.phone2);
  if (!wa) return 'phone1';
  if (wa === p1) return 'phone1';
  if (p2.length === 10 && wa === p2) return 'phone2';
  return 'manual';
}

/**
 * Restore WhatsApp selector from a booking draft. Explicit snapshot source wins so
 * "Same as Contact 1" does not jump to Other after customer-master hydrate.
 * @param {object|null|undefined} snap
 * @param {object|null|undefined} customer
 */
export function restoreWhatsappFromDraftSnapshot(snap, customer = null) {
  const explicit = snap?.whatsappSource ?? snap?.whatsapp_source;
  const manual = phoneInputDigits(
    snap?.whatsappManual ?? snap?.whatsapp_manual ?? customer?.whatsapp ?? ''
  );
  if (explicit != null && String(explicit).trim() !== '') {
    return { source: normalizeWhatsappSource(explicit), manual };
  }
  return {
    source: inferWhatsappSource({
      whatsapp: manual || customer?.whatsapp,
      phone1: snap?.contactNo1 ?? snap?.contact_no1 ?? customer?.phone1,
      phone2: snap?.contactNo2 ?? snap?.contact_no2 ?? customer?.phone2,
    }),
    manual,
  };
}

/**
 * Map saved customer + optional order snapshot into booking contact fields.
 * This booking's snapshot always wins over the shared customer master so
 * editing bill 25 cannot rewrite bill 24.
 * @param {object|null|undefined} customer
 * @param {object|null|undefined} orderSnap
 */
export function hydrateBookingCustomerFields(customer, orderSnap = null) {
  const c = customer || {};
  const orderCustomerId = orderSnap?.customer_id;
  const snapshotBelongsToCustomer =
    !orderCustomerId || !c.id || String(orderCustomerId) === String(c.id);
  const o = snapshotBelongsToCustomer && orderSnap && typeof orderSnap === 'object' ? orderSnap : {};

  const phone1 = normalizePhone(o.contact_phone1 || c.phone1 || '');
  const phone2FromOrder = normalizePhone(o.pickup_number || '');
  const phone2FromCustomer = normalizePhone(c.phone2 || '');
  const contactNo2 = phone2FromOrder || phone2FromCustomer;
  const sameAsPhone1 = !!phone1 && !!contactNo2 && contactNo2 === phone1;
  const nameFromCustomer = String(c.phone2_name || '').trim();
  const nameFromOrder = String(o.pickup_name || '').trim();
  const contact2Name = sameAsPhone1
    ? String(c.name || nameFromOrder || nameFromCustomer || '').slice(0, 60)
    : String(nameFromOrder || nameFromCustomer || '').slice(0, 60);

  const orderAddr = String(o.contact_address || '').trim();
  const customerAddr = String(c.address || '').trim();
  const address = orderAddr || customerAddr;

  const masterPhone1 = normalizePhone(c.phone1 || '');
  let whatsappSource = inferWhatsappSource({
    whatsapp: c.whatsapp,
    phone1,
    phone2: contactNo2,
  });
  if (whatsappSource === 'manual' && phone1 && phone1 !== masterPhone1) {
    whatsappSource = 'phone1';
  }

  return {
    contactNo1: phone1,
    contactNo2,
    contact2Name,
    contactNo2SameAsPhone1: sameAsPhone1,
    address,
    whatsappSource,
    whatsappManual: phoneInputDigits(c.whatsapp || ''),
  };
}

/**
 * Display-only contact summary for Process Order / lists.
 * @param {object|null|undefined} customer
 * @param {object|null|undefined} orderSnap
 */
export function bookingCustomerContactSummary(customer, orderSnap = null) {
  const hydrated = hydrateBookingCustomerFields(customer, orderSnap);
  return {
    contactNo1: hydrated.contactNo1 || '—',
    contactNo2: hydrated.contactNo2 || '—',
    contact2Name: hydrated.contact2Name || '—',
    address: hydrated.address || '—',
  };
}
