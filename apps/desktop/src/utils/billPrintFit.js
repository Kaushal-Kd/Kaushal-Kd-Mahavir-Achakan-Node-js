/**
 * Measure the printed bill against one sheet and tighten type/spacing only as
 * much as needed. Row-count guesses go stale whenever header, totals, or
 * letterhead change; this uses the live layout height instead.
 */

export const BILL_PRINT_FIT = {
  productMin: 8,
  accessoryMin: 7,
  baseMin: 10,
  headingMin: 14,
  padY0: 7,
  padYMin: 2,
  padX0: 10,
  padXMin: 6,
  headPadY0: 8,
  headPadYMin: 3,
  sectionPadY0: 6,
  sectionPadYMin: 2,
  totalsPadY0: 3,
  totalsPadYMin: 2,
  chromeMin: 0.55,
  lineHeight0: 1.35,
  lineHeightMin: 1.12,
  zoomMin: 0.88,
  safety: 0.992,
  maxIter: 12,
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function mmToPx(mm) {
  return (Number(mm) / 25.4) * 96;
}

export function billPageContentHeightPx({ pageHeightMm = 297, pageMarginMm = 8 } = {}) {
  const height = Number(pageHeightMm);
  const margin = Number(pageMarginMm);
  if (!Number.isFinite(height) || height <= 0) return mmToPx(297 - 16);
  const sides = Number.isFinite(margin) ? Math.max(0, margin) * 2 : 16;
  return mmToPx(Math.max(40, height - sides));
}

export function computeBillPrintFitVars(t, base = {}) {
  const u = Math.min(1, Math.max(0, Number(t) || 0));
  const baseSize = Number(base.baseSize) || 12;
  const product0 = Number(base.productSize) || baseSize;
  const accessory0 = Number(base.accessorySize) || Math.max(6, baseSize - 1);
  const heading0 = Number(base.headingSize) || 20;
  return {
    t: u,
    productSize: Math.max(BILL_PRINT_FIT.productMin, round1(lerp(product0, BILL_PRINT_FIT.productMin, u))),
    accessorySize: Math.max(
      BILL_PRINT_FIT.accessoryMin,
      round1(lerp(accessory0, BILL_PRINT_FIT.accessoryMin, u))
    ),
    baseSize: Math.max(BILL_PRINT_FIT.baseMin, round1(lerp(baseSize, BILL_PRINT_FIT.baseMin, u))),
    headingSize: Math.max(
      BILL_PRINT_FIT.headingMin,
      round1(lerp(heading0, BILL_PRINT_FIT.headingMin, u))
    ),
    padY: Math.round(lerp(BILL_PRINT_FIT.padY0, BILL_PRINT_FIT.padYMin, u)),
    padX: Math.round(lerp(BILL_PRINT_FIT.padX0, BILL_PRINT_FIT.padXMin, u)),
    headPadY: Math.round(lerp(BILL_PRINT_FIT.headPadY0, BILL_PRINT_FIT.headPadYMin, u)),
    sectionPadY: Math.round(lerp(BILL_PRINT_FIT.sectionPadY0, BILL_PRINT_FIT.sectionPadYMin, u)),
    totalsPadY: round1(lerp(BILL_PRINT_FIT.totalsPadY0, BILL_PRINT_FIT.totalsPadYMin, u)),
    tableLineHeight: round2(lerp(BILL_PRINT_FIT.lineHeight0, BILL_PRINT_FIT.lineHeightMin, u)),
    chrome: round2(lerp(1, BILL_PRINT_FIT.chromeMin, u)),
    zoom: 1,
  };
}

export function applyBillPrintFitVars(root, vars) {
  if (!root?.style) return;
  root.style.setProperty('--bill-product-size', `${vars.productSize}px`);
  root.style.setProperty('--bill-accessory-size', `${vars.accessorySize}px`);
  root.style.setProperty('--bill-base-size', `${vars.baseSize}px`);
  root.style.setProperty('--bill-heading-size', `${vars.headingSize}px`);
  root.style.setProperty('--bill-pad-y', `${vars.padY}px`);
  root.style.setProperty('--bill-pad-x', `${vars.padX}px`);
  root.style.setProperty('--bill-head-pad-y', `${vars.headPadY}px`);
  root.style.setProperty('--bill-section-pad-y', `${vars.sectionPadY}px`);
  root.style.setProperty('--bill-totals-pad-y', `${vars.totalsPadY}px`);
  root.style.setProperty('--bill-table-lh', String(vars.tableLineHeight));
  root.style.setProperty('--bill-chrome', String(vars.chrome));
  root.style.setProperty('--bill-page-zoom', String(vars.zoom ?? 1));
}

/**
 * Smallest compactness in [0, 1] that does not overflow. If even t=1 overflows,
 * returns t=1 so the caller can apply a last-resort zoom.
 */
export function searchBillFitLevel({ overflowsAt, maxIter = BILL_PRINT_FIT.maxIter } = {}) {
  if (typeof overflowsAt !== 'function') return { t: 0 };
  if (!overflowsAt(0)) return { t: 0 };
  if (overflowsAt(1)) return { t: 1 };
  let lo = 0;
  let hi = 1;
  let best = 1;
  const steps = Math.max(4, Number(maxIter) || BILL_PRINT_FIT.maxIter);
  for (let i = 0; i < steps; i += 1) {
    const mid = (lo + hi) / 2;
    if (overflowsAt(mid)) lo = mid;
    else {
      best = mid;
      hi = mid;
    }
  }
  return { t: best };
}

function readBillFitBase(root) {
  const ds = root?.dataset || {};
  return {
    productSize: Number(ds.productSize) || 12,
    accessorySize: Number(ds.accessorySize) || 11,
    baseSize: Number(ds.baseSize) || 12,
    headingSize: Number(ds.headingSize) || 20,
  };
}

function measureBillHeight(root) {
  const box = root.getBoundingClientRect();
  return Math.ceil(Math.max(root.scrollHeight || 0, box.height || 0));
}

export function fitBillDocumentToOnePage(root, options = {}) {
  if (!root) return { t: 0, zoom: 1 };
  const pageHeightMm = Number(root.dataset?.pageHeightMm || options.pageHeightMm || 297);
  const pageMarginMm = Number(root.dataset?.pageMarginMm || options.pageMarginMm || 8);
  const available =
    billPageContentHeightPx({ pageHeightMm, pageMarginMm }) * BILL_PRINT_FIT.safety;
  const base = readBillFitBase(root);

  const apply = (t, zoom = 1) => {
    const vars = computeBillPrintFitVars(t, base);
    vars.zoom = zoom;
    applyBillPrintFitVars(root, vars);
    void root.offsetHeight;
  };

  apply(0, 1);
  if (measureBillHeight(root) <= available) return { t: 0, zoom: 1 };

  const overflowsAt = (t) => {
    apply(t, 1);
    return measureBillHeight(root) > available;
  };

  const { t } = searchBillFitLevel({ overflowsAt });
  apply(t, 1);
  let zoom = 1;
  const compactHeight = measureBillHeight(root);
  if (compactHeight > available) {
    zoom = Math.max(BILL_PRINT_FIT.zoomMin, available / compactHeight);
    apply(t, zoom);
  }
  return { t, zoom };
}

function waitForDocumentAssets(doc) {
  const fonts = doc?.fonts?.ready ? doc.fonts.ready.catch(() => undefined) : Promise.resolve();
  const images = [...(doc?.images || [])].map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  });
  return Promise.all([fonts, ...images]);
}

/** Size the hidden iframe to A4 CSS width so wrapping matches print, then fit. */
export async function preparePrintedBill(frame) {
  const doc = frame?.contentDocument;
  const root = doc?.querySelector?.('.bill-document[data-bill-fit="page"]');
  if (!root) return null;
  frame.style.width = '210mm';
  frame.style.height = 'auto';
  frame.style.minHeight = '297mm';
  try {
    await waitForDocumentAssets(doc);
  } catch {
    /* measure anyway */
  }
  return fitBillDocumentToOnePage(root);
}
