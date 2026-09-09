import { normalizePhone, phoneInputDigits } from '@wrs/shared';

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
 * Map saved customer + optional order snapshot into booking contact fields.
 * Order snapshot wins when customer master is empty (legacy bookings).
 * @param {object|null|undefined} customer
 * @param {object|null|undefined} orderSnap
 */
export function hydrateBookingCustomerFields(customer, orderSnap = null) {
  const c = customer || {};
  const o = orderSnap || {};

  const phone1 = normalizePhone(o.contact_phone1 || c.phone1 || '');
  const phone2FromCustomer = normalizePhone(c.phone2 || '');
  const phone2FromOrder = normalizePhone(o.pickup_number || '');
  const contactNo2 = phone2FromCustomer || phone2FromOrder;
  const sameAsPhone1 = !!phone1 && !!contactNo2 && contactNo2 === phone1;
  const nameFromCustomer = String(c.phone2_name || '').trim();
  const nameFromOrder = String(o.pickup_name || '').trim();
  const contact2Name = sameAsPhone1
    ? String(c.name || nameFromOrder || nameFromCustomer || '').slice(0, 60)
    : String(nameFromCustomer || nameFromOrder || '').slice(0, 60);

  const orderAddr = String(o.contact_address || '').trim();
  const customerAddr = String(c.address || '').trim();
  const address = orderAddr || customerAddr;

  return {
    contactNo1: phone1,
    contactNo2,
    contact2Name,
    contactNo2SameAsPhone1: sameAsPhone1,
    address,
    whatsappSource: inferWhatsappSource(c),
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
