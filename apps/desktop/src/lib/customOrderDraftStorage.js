const LIST_KEY = 'wrs.custom_order_drafts_v1';
const ACTIVE_KEY = 'wrs.custom_order_active_draft_id';
export const SNAPSHOT_VERSION = 1;
export const MAX_CUSTOM_ORDER_DRAFTS = 25;

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function createLocalDraftId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `co_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
  return sorted.slice(0, MAX_CUSTOM_ORDER_DRAFTS);
}

export function upsertCustomOrderDraft({ id, title, snapshot }) {
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

export function removeCustomOrderDraft(id) {
  const sid = String(id || '').trim();
  if (!sid) return;
  const list = readDraftList().filter((d) => d.id !== sid);
  writeDraftList(list);
  if (getActiveDraftId() === sid) {
    setActiveDraftId(null);
  }
}

function snapStr(snapshot, ...keys) {
  for (const key of keys) {
    const v = String(snapshot?.[key] ?? '').trim();
    if (v) return v;
  }
  return '';
}

function formValues(snapshot) {
  return snapshot?.values && typeof snapshot.values === 'object' ? snapshot.values : snapshot;
}

export function draftLabelFromSnapshot(snapshot) {
  const values = formValues(snapshot);
  const name = String(values?.customer_name || '').trim();
  if (name) return name;
  const product = String(values?.product_name || values?.design_name || '').trim();
  if (product) return product;
  return 'Untitled custom order';
}

/** True when the snapshot has nothing worth persisting (auto-save skips / removes draft). */
export function isSnapshotTriviallyEmpty(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return true;
  if (snapshot.customer && String(snapshot.customer.id || '').trim()) return false;
  if (snapStr(snapshot, 'customerQuery')) return false;

  const values = formValues(snapshot);
  if (!values || typeof values !== 'object') return true;

  const textFields = [
    'customer_name',
    'customer_phone',
    'customer_phone2',
    'customer_address',
    'design_name',
    'product_name',
    'remarks',
    'category_id',
    'color',
    'size',
    'delivery_date',
    'return_date',
    'marriage_date',
    'trial_date',
    'trial_product',
    'tailor_name',
    'tailor_date',
  ];
  if (textFields.some((f) => String(values[f] ?? '').trim())) return false;
  if (values.given_to_tailor) return false;

  const measurements = values.measurements || {};
  if (Object.values(measurements).some((v) => String(v ?? '').trim())) return false;

  const retrials = Array.isArray(values.retrials) ? values.retrials : [];
  if (retrials.some((r) => String(r?.date ?? '').trim())) return false;

  const designImages = Array.isArray(values.design_images) ? values.design_images : [];
  const trialImages = Array.isArray(values.trial_images) ? values.trial_images : [];
  if (designImages.length > 0 || trialImages.length > 0) return false;

  return true;
}
