const LIST_KEY = 'wrs.booking_drafts_v1';
const ACTIVE_KEY = 'wrs.booking_active_draft_id';
export const SNAPSHOT_VERSION = 1;
export const MAX_BOOKING_DRAFTS = 25;

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readDraftList() {
  if (typeof localStorage === 'undefined') return [];
  const parsed = safeParse(localStorage.getItem(LIST_KEY));
  return Array.isArray(parsed) ? parsed : [];
}

export function writeDraftList(list) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LIST_KEY, JSON.stringify(list));
}

export function getActiveDraftId() {
  if (typeof localStorage === 'undefined') return null;
  const id = String(localStorage.getItem(ACTIVE_KEY) || '').trim();
  return id || null;
}

export function setActiveDraftId(id) {
  if (typeof localStorage === 'undefined') return;
  if (!id) {
    localStorage.removeItem(ACTIVE_KEY);
    return;
  }
  localStorage.setItem(ACTIVE_KEY, String(id));
}

export function pruneDraftList(list) {
  const sorted = [...list].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  return sorted.slice(0, MAX_BOOKING_DRAFTS);
}

export function upsertBookingDraft({ id, title, snapshot }) {
  const now = Date.now();
  const list = readDraftList();
  const idx = list.findIndex((d) => d.id === id);
  const row = {
    id,
    title: String(title || 'Untitled draft').slice(0, 120),
    updatedAt: now,
    snapshot: { ...snapshot, v: SNAPSHOT_VERSION },
  };
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...row };
  } else {
    list.unshift(row);
  }
  writeDraftList(pruneDraftList(list));
  return row;
}

export function removeBookingDraft(id) {
  const sid = String(id || '').trim();
  if (!sid) return;
  const list = readDraftList().filter((d) => d.id !== sid);
  writeDraftList(list);
  if (getActiveDraftId() === sid) {
    setActiveDraftId(null);
  }
}

export function draftLabelFromSnapshot(snapshot) {
  const c = snapshot?.customer;
  const name = String(c?.name || '').trim();
  if (name) return name;
  const lines = snapshot?.lines || [];
  if (lines.length > 0) {
    const first = String(lines[0]?.name_snapshot || '').trim();
    if (first) return `${first}${lines.length > 1 ? ` +${lines.length - 1}` : ''}`;
  }
  return 'Untitled booking';
}

function snapStr(snapshot, ...keys) {
  for (const key of keys) {
    const v = String(snapshot[key] ?? '').trim();
    if (v) return v;
  }
  return '';
}

/** True when the snapshot has nothing worth persisting (auto-save skips / removes draft). */
export function isSnapshotTriviallyEmpty(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return true;
  if (snapshot.customer && String(snapshot.customer.id || '').trim()) return false;

  const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  if (lines.length > 0) return false;

  if (snapStr(snapshot, 'customerQuery')) return false;
  if (snapStr(snapshot, 'customerNotes', 'customer_notes')) return false;
  if (snapStr(snapshot, 'referenceName', 'reference_name')) return false;
  if (snapStr(snapshot, 'contactNo1', 'contact_no1')) return false;
  if (snapStr(snapshot, 'contactNo2', 'contact_no2')) return false;
  if (snapStr(snapshot, 'contact2Name', 'contact2_name')) return false;
  if (snapStr(snapshot, 'whatsappManual', 'whatsapp_manual')) return false;
  if (snapStr(snapshot, 'address')) return false;
  if (snapStr(snapshot, 'advanceAccountId', 'advance_account_id')) return false;
  if (snapStr(snapshot, 'securityAccountId', 'security_account_id')) return false;
  if (snapStr(snapshot, 'nextBookingGapDaysInput', 'next_booking_gap_days')) return false;
  if (snapStr(snapshot, 'previousBookingGapDaysInput', 'previous_booking_gap_days')) return false;

  if (Number(snapshot.advanceAmount ?? snapshot.advance_amount ?? 0) > 0) return false;
  if (Number(snapshot.deposit ?? 0) > 0) return false;
  if (Number(snapshot.bookingDiscountValue ?? snapshot.booking_discount_value ?? 0) > 0) return false;
  if (snapshot.paidSecurityAmt || snapshot.paid_security_amt) return false;

  const mad = snapshot.manualAccessoryDraft || snapshot.manual_accessory_draft;
  if (mad && typeof mad === 'object' && Object.keys(mad).length > 0) return false;

  const quickIds = snapshot.quickBillDraftIds || snapshot.quick_bill_draft_ids;
  if (Array.isArray(quickIds) && quickIds.length > 0) return false;

  return true;
}
