import { accessoryRentableQty } from '@wrs/shared/utils/accessoryStock.js';
import { resolveAccessoryChecklistStageFlags } from '@wrs/shared/utils/stageFlags.js';

export function isSellAccessoryLine(row) {
  return String(row?.type || 'rent') === 'sell';
}

export function isRentAccessoryLine(row) {
  return !isSellAccessoryLine(row);
}

export function createBookingLineId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Resolve accessory id from cart / draft / API row shapes. */
export function accessoryRowId(row) {
  const id = row?.accessory_id ?? row?.id ?? null;
  if (id == null || id === '') return '';
  return String(id);
}

/** Coerce persisted accessories into an array (drafts may store a keyed object). */
export function coerceAccessoriesList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

/**
 * Ensure each accessory row has stable ids for modal selection state.
 * @param {object[]} accessories
 */
export function ensureAccessoryLineIds(accessories) {
  return coerceAccessoriesList(accessories).map((raw) => {
    const accessory_id = accessoryRowId(raw) || null;
    return {
      ...raw,
      accessory_id,
      line_id: raw?.line_id || createBookingLineId(),
      name_snapshot: String(raw?.name_snapshot || raw?.name || 'Accessory').trim() || 'Accessory',
      image_url: raw?.image_url || raw?.main_image || null,
      category_id: raw?.category_id ?? raw?.accessory_category_id ?? null,
      category_name: String(raw?.category_name || raw?.category_label || '').trim(),
      selected: raw?.selected !== false,
      remarks: String(raw?.remarks || '').trim().slice(0, 500),
    };
  });
}

/**
 * Normalize booking draft lines after localStorage restore (ids + accessory list shape).
 * @param {object[]} lines
 */
export function normalizeBookingLinesFromDraft(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => {
    if (!line || typeof line !== 'object') return line;
    if (line.line_kind === 'standalone_accessory') {
      const accessory_id = accessoryRowId(line) || null;
      return {
        ...line,
        line_id: line.line_id || createBookingLineId(),
        accessory_id,
        name_snapshot: String(line.name_snapshot || line.name || 'Accessory').trim() || 'Accessory',
        main_image: line.main_image || line.image_url || null,
        category_id: line.category_id ?? null,
        category_name: String(line.category_name || line.category_label || '').trim(),
      };
    }
    const accessories = ensureAccessoryLineIds(line.accessories);
    return {
      ...line,
      line_id: line.line_id || createBookingLineId(),
      accessories: accessories.length ? sortAccessoriesByDisplayOrder(accessories) : accessories,
    };
  });
}

/** Per-accessory order within a category (product_accessories.display_order). */
export function accessoryDisplayOrderValue(a) {
  const d = a?.display_order;
  if (d !== undefined && d !== null && Number.isFinite(Number(d))) {
    const n = Number(d);
    if (n >= 10000) return n % 10000;
    return n;
  }
  return 9999;
}

/** Category order from CategoriesEditor product → accessory category mapping. */
export function accessoryCategoryDisplayOrderValue(a) {
  const c = a?.category_display_order;
  if (c !== undefined && c !== null && Number.isFinite(Number(c))) return Number(c);
  const persisted = a?.display_order;
  if (persisted !== undefined && persisted !== null && Number.isFinite(Number(persisted))) {
    const n = Number(persisted);
    if (n >= 10000) return Math.floor(n / 10000);
  }
  return 9999;
}

/** Sort like recommended-accessory dropdown: category mapping first, then item order. */
export function sortAccessoriesByDisplayOrder(accessories) {
  const list = Array.isArray(accessories) ? [...accessories] : [];
  return list.sort((a, b) => {
    const catDiff = accessoryCategoryDisplayOrderValue(a) - accessoryCategoryDisplayOrderValue(b);
    if (catDiff !== 0) return catDiff;
    return accessoryDisplayOrderValue(a) - accessoryDisplayOrderValue(b);
  });
}

/** Category order within rent, then within sell — sell lines always last under a product. */
export function sortAccessoriesRentThenSell(accessories) {
  const sorted = sortAccessoriesByDisplayOrder(accessories);
  const rent = [];
  const sell = [];
  for (const a of sorted) {
    if (isSellLine(a)) sell.push(a);
    else rent.push(a);
  }
  return [...rent, ...sell];
}

/** Persisted on order_accessories — encodes category + item order for DB sort. */
export function compositeAccessoryDisplayOrder(a, fallbackIndex = 0) {
  const cat = accessoryCategoryDisplayOrderValue(a);
  const item = accessoryDisplayOrderValue(a);
  const itemPart = item < 9999 ? item : fallbackIndex;
  return cat * 10000 + itemPart;
}

export function nextAccessoryDisplayOrder(accessories) {
  let max = -1;
  for (const a of accessories || []) {
    const v = compositeAccessoryDisplayOrder(a);
    if (v > max) max = v;
  }
  return max + 1;
}

export function normalizeAccessoryOrderStatus(v) {
  const s = String(v || '').trim();
  if (s === 'given_with_rent' || s === 'pack_with_rent' || s === 'regular') return s;
  return 'regular';
}

export function accessoryDefaultType(accessory) {
  const kind = String(accessory?.default_type || '').toLowerCase();
  if (kind === 'sell') return 'sell';
  return 'rent';
}

function catalogPriceForType(catalog, type) {
  const rent = Number(catalog?.catalog_price_rent ?? catalog?.price_rent ?? 0);
  const sell = Number(catalog?.catalog_price_sell ?? catalog?.price_sell ?? 0);
  const selected = type === 'sell' ? sell : rent;
  if (Number.isFinite(selected)) return selected;
  return Number(catalog?.price ?? 0) || 0;
}

export function accessoryPriceForType(catalog, type) {
  return catalogPriceForType(catalog, type);
}

export function accessoryDefaultOrderStatus(accessory) {
  return normalizeAccessoryOrderStatus(accessory?.default_order_status || 'given_with_rent');
}

/**
 * Build accessory rows from recommendations API payload (same shape as Create Order).
 * @param {{ data?: object[] }} rec
 * @param {Map<string, string>} [categoryLabelById]
 */
export function recommendationRowsToAccessoryLines(rec, categoryLabelById = new Map()) {
  const rows = Array.isArray(rec?.data) ? rec.data : [];
  return rows.map((a) => {
    const type = accessoryDefaultType(a);
    const catalog_price_rent = Number(a.price_rent || 0);
    const catalog_price_sell = Number(a.price_sell || 0);
    const category_id = a.category_id ?? a.accessory_category_id ?? null;
    const category_name =
      String(a.category_name || '').trim() ||
      String(a.category_label || '').trim() ||
      String(a?.category?.name || '').trim() ||
      String(categoryLabelById.get(String(category_id || '')) || '').trim() ||
      '';
    return {
      line_id: createBookingLineId(),
      accessory_id: a.id,
      name_snapshot: a.name,
      image_url: a.image_url || null,
      qty: 1,
      price: accessoryPriceForType(
        { price_rent: catalog_price_rent, price_sell: catalog_price_sell },
        type
      ),
      catalog_price_rent,
      catalog_price_sell,
      discount: 0,
      type,
      accessory_order_status: accessoryDefaultOrderStatus(a),
      selected: false,
      source: a.source || 'recommended',
      category_id,
      category_name,
      display_order: Number(a.display_order ?? 0),
      category_display_order:
        a.category_display_order !== undefined && a.category_display_order !== null
          ? Number(a.category_display_order || 0)
          : null,
      free_qty: Number(a.free_qty || 0),
      booked_qty: Number(a.booked_qty || 0),
      total_qty: Number(a.total_qty || 0),
      spare_qty: Number(a.spare_qty || 0),
      rentable_qty:
        a.rentable_qty != null && a.rentable_qty !== ''
          ? Math.max(0, Number(a.rentable_qty) || 0)
          : undefined,
      in_shop_qty:
        a.in_shop_qty != null && a.in_shop_qty !== ''
          ? Math.max(0, Number(a.in_shop_qty) || 0)
          : undefined,
      stock_qty: Math.max(0, Number(a.qty ?? a.total_qty ?? 0) || 0),
      is_required: !!a.is_required,
      is_recommended: !!a.is_recommended,
      remarks: '',
    };
  });
}

/**
 * @param {object} accessory Catalog row from accessories list API.
 * @param {Map<string, string>} categoryLabelById
 */
export function catalogAccessoryToLine(accessory, categoryLabelById = new Map()) {
  const type = accessoryDefaultType(accessory);
  const catalog_price_rent = Number(accessory.price_rent || 0);
  const catalog_price_sell = Number(accessory.price_sell || 0);
  const categoryId = accessory.category_id || null;
  const categoryName = String(
    accessory.category_name ||
      accessory.category_label ||
      categoryLabelById.get(String(categoryId || '')) ||
      ''
  ).trim();
  const stockQty = Math.max(0, Number(accessory.qty || 0));
  return {
    line_id: createBookingLineId(),
    accessory_id: accessory.id,
    name_snapshot: accessory.name,
    image_url: accessory.image_url || null,
    qty: 1,
    price: accessoryPriceForType(
      { price_rent: catalog_price_rent, price_sell: catalog_price_sell },
      type
    ),
    catalog_price_rent,
    catalog_price_sell,
    discount: 0,
    type,
    accessory_order_status: accessoryDefaultOrderStatus(accessory),
    selected: true,
    source: 'manual',
    category_id: categoryId,
    category_name: categoryName,
    stock_qty: stockQty,
    free_qty: type === 'sell' ? stockQty : Number(accessory.free_qty ?? stockQty),
    booked_qty: 0,
    total_qty: stockQty,
    is_required: false,
    is_recommended: false,
    display_order: 10000,
    remarks: '',
  };
}

/**
 * Merge saved cart accessories into recommendation catalog for Create Order handoff.
 * @param {object[]} catalogLines
 * @param {object[]} savedLines
 */
export function mergeSavedCartAccessoriesWithCatalog(catalogLines, savedLines) {
  const saved = coerceAccessoriesList(savedLines);
  const savedById = new Map();
  for (const raw of saved) {
    const accessory_id = accessoryRowId(raw);
    if (!accessory_id) continue;
    savedById.set(accessory_id, {
      ...raw,
      accessory_id,
      line_id: raw?.line_id || createBookingLineId(),
    });
  }
  const merged = (catalogLines || []).map((recRow) => {
    const ex = savedById.get(String(recRow.accessory_id || ''));
    if (!ex) return recRow;
    savedById.delete(String(recRow.accessory_id));
    return {
      ...recRow,
      line_id: ex.line_id || recRow.line_id,
      selected: true,
      qty: Math.max(1, Number(ex.qty ?? recRow.qty) || 1),
      price: Number(ex.price ?? recRow.price) || recRow.price,
      type: ex.type ?? recRow.type,
      accessory_order_status: ex.accessory_order_status ?? recRow.accessory_order_status,
      category_display_order: ex.category_display_order ?? recRow.category_display_order,
      display_order: ex.display_order ?? recRow.display_order,
      remarks: String(ex.remarks ?? recRow.remarks ?? '').trim().slice(0, 500),
      source: ex.source || recRow.source,
    };
  });
  for (const ex of savedById.values()) {
    merged.push({
      ...ex,
      line_id: ex.line_id || createBookingLineId(),
      selected: true,
      qty: Math.max(1, Number(ex.qty) || 1),
    });
  }
  return merged;
}

/** Persist only selected accessories on availability cart drafts. */
export function selectedAccessoriesForCartDraft(accessories) {
  return (accessories || [])
    .filter((a) => a?.accessory_id && a.selected)
    .map((a) => ({
      line_id: a.line_id,
      accessory_id: a.accessory_id,
      name_snapshot: a.name_snapshot,
      image_url: a.image_url || null,
      qty: Math.max(1, Number(a.qty) || 1),
      price: Number(a.price) || 0,
      catalog_price_rent: Number(a.catalog_price_rent ?? 0),
      catalog_price_sell: Number(a.catalog_price_sell ?? 0),
      type: a.type || 'rent',
      accessory_order_status: a.accessory_order_status,
      category_id: a.category_id ?? null,
      category_name: a.category_name || '',
      source: a.source || 'recommended',
      display_order: a.display_order,
      category_display_order: a.category_display_order ?? null,
      remarks: String(a.remarks || '').trim().slice(0, 500),
      selected: true,
    }));
}

export function filterRecommendedGroupItems(items, searchTerm) {
  const term = String(searchTerm || '').trim().toLowerCase();
  if (!term) return items;
  return items.filter((a) => String(a.name_snapshot || '').toLowerCase().includes(term));
}

export function countSelectedAccessories(accessories) {
  return (accessories || []).filter((a) => a?.selected && a?.accessory_id).length;
}

/** Booking line or bill row is a sale (not rental) line. */
export function isSellLine(row) {
  return String(row?.type || 'rent').toLowerCase().trim() === 'sell';
}

/** Default checklist stages for given-with-rent accessories (counter handover at booking). */
export const GIVEN_WITH_RENT_LOCKED_STAGE_FLAGS = {
  prepared: true,
  delivered: true,
  received: false,
};

/** Resolve given_status from order row or booking draft field names. */
export function accessoryGivenStatus(row) {
  if (!row) return 'regular';
  const raw = row.given_status ?? row.accessory_order_status ?? '';
  return normalizeAccessoryOrderStatus(raw);
}

export function isGivenWithRentAccessory(row) {
  if (!row || isSellLine(row)) return false;
  return accessoryGivenStatus(row) === 'given_with_rent';
}

export function isPackWithRentAccessory(row) {
  if (!row || isSellLine(row)) return false;
  return accessoryGivenStatus(row) === 'pack_with_rent';
}

/** Human-readable given-status label for bills, checklist, and PDFs. */
export function formatAccessoryGivenStatusLabel(row) {
  const status = accessoryGivenStatus(row);
  if (status === 'given_with_rent') return 'Given with rent';
  if (status === 'pack_with_rent') return 'Pack with rent';
  return '';
}

export function givenRentBooleansFromStatus(status) {
  const s = normalizeAccessoryOrderStatus(status);
  return {
    given_with_rent: s === 'given_with_rent',
    pack_with_rent: s === 'pack_with_rent',
  };
}

/** Default stage flags persisted on create for counter-handover accessories. */
export function defaultHandedOverAccessoryStageFlags() {
  return { ...GIVEN_WITH_RENT_LOCKED_STAGE_FLAGS };
}

/** True for sell accessories or given-with-rent accessories (counter handover). */
export function isCounterHandoverAccessory(row) {
  if (isSellLine(row)) return true;
  return isGivenWithRentAccessory(row);
}

/** True when a checklist stage toggle is locked for given-with-rent rent accessories. */
export function isGivenWithRentLockedStage(row, stageKey) {
  if (!isGivenWithRentAccessory(row)) return false;
  return stageKey === 'prepared' || stageKey === 'delivered';
}

/** Merge locked prepared/delivered flags into an accessory stage draft row. */
export function applyGivenWithRentStageDefaults(flags, row) {
  if (!isGivenWithRentAccessory(row)) return flags;
  return resolveAccessoryChecklistStageFlags({ ...row, stage_flags: flags });
}

/** Selected accessory rows on a product line in Create Order. */
export function getSelectedAccessories(line) {
  return (line?.accessories || []).filter((a) => a?.selected);
}

/**
 * Product has at least one selected accessory and every selected accessory is type sell.
 * @param {object} line
 */
export function productLineIsSaleOnly(line) {
  if (line?.line_kind === 'standalone_accessory') return false;
  const selected = getSelectedAccessories(line);
  if (selected.length === 0) return false;
  return selected.every((a) => isSellLine(a));
}

/** Booking table section bucket for a line (rent/sale × product/standalone). */
export function lineBookingSection(line) {
  if (line?.line_kind === 'standalone_accessory') {
    return isSellLine(line) ? 'sale_standalone' : 'rent_standalone';
  }
  if (productLineIsSaleOnly(line)) return 'sale_product';
  return 'rent_product';
}

/** Sort lines or persisted items by display_order, then stable id. */
export function sortLinesByDisplayOrder(arr) {
  return [...(arr || [])].sort((a, b) => {
    const ao = Number(a.display_order ?? 0);
    const bo = Number(b.display_order ?? 0);
    if (ao !== bo) return ao - bo;
    const ak = String(a.line_id || a.id || '');
    const bk = String(b.line_id || b.id || '');
    return ak.localeCompare(bk);
  });
}

/** Lines belonging to one booking table section. */
export function linesInSection(lines, section) {
  return (lines || []).filter((line) => lineBookingSection(line) === section);
}

/** Next display_order for a new line in the given section. */
export function nextLineDisplayOrder(lines, section) {
  const inSection = linesInSection(lines, section);
  let max = -10;
  for (const line of inSection) {
    max = Math.max(max, Number(line.display_order ?? 0));
  }
  return max + 10;
}

/** Rent vs sell bucket for a linked accessory row. */
export function accessoryRentSellBucket(a) {
  return isSellLine(a) ? 'sell' : 'rent';
}

/** @alias getSelectedAccessories */
export function selectedAccessoriesForLine(line) {
  return getSelectedAccessories(line);
}

/** Locate a selected linked accessory and its parent product line. */
export function findLinkedAccessory(lines, accessoryLineId) {
  const accId = String(accessoryLineId || '').trim();
  if (!accId) return null;
  for (const line of lines || []) {
    if (line.line_kind === 'standalone_accessory') continue;
    const accessory = (line.accessories || []).find((a) => a.line_id === accId && a.selected);
    if (accessory) {
      return { parentLine: line, accessory, parentLineId: line.line_id };
    }
  }
  return null;
}

function bucketSelectedAccessories(accessories, bucket) {
  return (accessories || [])
    .filter((a) => a?.selected && accessoryRentSellBucket(a) === bucket)
    .sort((a, b) => {
      const d = accessoryDisplayOrderValue(a) - accessoryDisplayOrderValue(b);
      if (d !== 0) return d;
      const cat = accessoryCategoryDisplayOrderValue(a) - accessoryCategoryDisplayOrderValue(b);
      if (cat !== 0) return cat;
      return String(a.line_id).localeCompare(String(b.line_id));
    });
}

/** Apply user sequence within one rent/sell bucket (updates category_display_order + display_order). */
function applyAccessoryOrderToList(accessories, bucket, orderedLineIds) {
  const orderMap = new Map(orderedLineIds.map((id, idx) => [id, idx]));
  return (accessories || []).map((a) => {
    if (!a?.selected || accessoryRentSellBucket(a) !== bucket) return a;
    const idx = orderMap.get(a.line_id);
    if (idx === undefined) return a;
    const itemOrder = idx * 10;
    return {
      ...a,
      category_display_order: idx,
      display_order: itemOrder,
    };
  });
}

function isProductLineDropTarget(line) {
  return line && line.line_kind !== 'standalone_accessory';
}

/**
 * Reorder linked accessories within the same product and rent/sell bucket.
 * @returns {{ accessories: object[], ok: boolean, reason?: string }}
 */
export function reorderLinkedAccessories(accessories, dragId, dropId) {
  const drag = String(dragId || '').trim();
  const drop = String(dropId || '').trim();
  if (!drag || !drop || drag === drop) return { accessories, ok: false };

  const dragAcc = (accessories || []).find((a) => a.line_id === drag && a.selected);
  const dropAcc = (accessories || []).find((a) => a.line_id === drop && a.selected);
  if (!dragAcc || !dropAcc) return { accessories, ok: false, reason: 'invalid_target' };

  const bucket = accessoryRentSellBucket(dragAcc);
  if (bucket !== accessoryRentSellBucket(dropAcc)) {
    return { accessories, ok: false, reason: 'bucket_mismatch' };
  }

  const orderedIds = bucketSelectedAccessories(accessories, bucket).map((a) => a.line_id);
  const fromIdx = orderedIds.indexOf(drag);
  const toIdx = orderedIds.indexOf(drop);
  if (fromIdx < 0 || toIdx < 0) return { accessories, ok: false };

  orderedIds.splice(fromIdx, 1);
  orderedIds.splice(toIdx, 0, drag);

  return {
    ok: true,
    accessories: sortAccessoriesRentThenSell(applyAccessoryOrderToList(accessories, bucket, orderedIds)),
  };
}

/**
 * Reorder or move a linked accessory (drop on product row or accessory row).
 * @param {object[]} lines
 * @param {string} dragAccId
 * @param {{ kind: 'product', parentLineId: string } | { kind: 'accessory', parentLineId: string, accessoryLineId: string }} dropTarget
 * @param {{ validateMergeQty?: (ctx: object) => boolean }} [options]
 * @returns {{ lines: object[], ok: boolean, reason?: string, merged?: boolean }}
 */
export function moveLinkedAccessory(lines, dragAccId, dropTarget, options = {}) {
  const found = findLinkedAccessory(lines, dragAccId);
  if (!found) return { lines, ok: false, reason: 'invalid_target' };

  const { parentLineId: sourceParentId, accessory: dragAcc } = found;
  const validateMerge = options.validateMergeQty;

  let targetParentId = '';
  let insertBeforeAccId = null;

  if (dropTarget?.kind === 'product') {
    targetParentId = String(dropTarget.parentLineId || '').trim();
  } else if (dropTarget?.kind === 'accessory') {
    targetParentId = String(dropTarget.parentLineId || '').trim();
    insertBeforeAccId = String(dropTarget.accessoryLineId || '').trim() || null;
  } else {
    return { lines, ok: false, reason: 'invalid_target' };
  }

  const targetLine = (lines || []).find((l) => l.line_id === targetParentId);
  if (!isProductLineDropTarget(targetLine)) return { lines, ok: false, reason: 'invalid_target' };

  const bucket = accessoryRentSellBucket(dragAcc);

  if (targetParentId === sourceParentId) {
    if (insertBeforeAccId && insertBeforeAccId !== dragAcc.line_id) {
      const dropAcc = (targetLine.accessories || []).find(
        (a) => a.line_id === insertBeforeAccId && a.selected
      );
      if (!dropAcc) return { lines, ok: false, reason: 'invalid_target' };
      if (accessoryRentSellBucket(dropAcc) !== bucket) {
        return { lines, ok: false, reason: 'bucket_mismatch' };
      }
      const reorder = reorderLinkedAccessories(targetLine.accessories, dragAcc.line_id, insertBeforeAccId);
      if (!reorder.ok) return { lines, ok: false, reason: reorder.reason };
      return {
        ok: true,
        lines: lines.map((l) =>
          l.line_id === sourceParentId ? { ...l, accessories: reorder.accessories } : l
        ),
      };
    }

    const orderedIds = bucketSelectedAccessories(targetLine.accessories, bucket)
      .map((a) => a.line_id)
      .filter((id) => id !== dragAcc.line_id);
    orderedIds.push(dragAcc.line_id);
    const reordered = sortAccessoriesRentThenSell(
      applyAccessoryOrderToList(targetLine.accessories, bucket, orderedIds)
    );
    return {
      ok: true,
      lines: lines.map((l) =>
        l.line_id === sourceParentId ? { ...l, accessories: reordered } : l
      ),
    };
  }

  if (insertBeforeAccId) {
    const dropAcc = (targetLine.accessories || []).find(
      (a) => a.line_id === insertBeforeAccId && a.selected
    );
    if (!dropAcc) return { lines, ok: false, reason: 'invalid_target' };
    if (accessoryRentSellBucket(dropAcc) !== bucket) {
      return { lines, ok: false, reason: 'bucket_mismatch' };
    }
  }

  const targetAccessories = targetLine.accessories || [];
  const duplicate = targetAccessories.find(
    (a) =>
      a.selected &&
      String(a.accessory_id) === String(dragAcc.accessory_id) &&
      a.line_id !== dragAcc.line_id
  );

  if (duplicate) {
    const mergedQty = Number(duplicate.qty || 1) + Number(dragAcc.qty || 1);
    if (validateMerge) {
      const ok = validateMerge({
        lines,
        targetParentLineId: targetParentId,
        mergedAccessory: { ...duplicate, qty: mergedQty },
        mergedQty,
        omitAccessoryLineId: dragAcc.line_id,
      });
      if (!ok) return { lines, ok: false, reason: 'duplicate_merge_failed' };
    }
    const nextLines = lines.map((l) => {
      if (l.line_id === sourceParentId) {
        return {
          ...l,
          accessories: (l.accessories || []).filter((a) => a.line_id !== dragAcc.line_id),
        };
      }
      if (l.line_id === targetParentId) {
        return {
          ...l,
          accessories: (l.accessories || []).map((a) =>
            a.line_id === duplicate.line_id ? { ...a, qty: mergedQty } : a
          ),
        };
      }
      return l;
    });
    return { ok: true, lines: nextLines, merged: true };
  }

  const moving = { ...dragAcc, source: 'manual' };
  const baseTargetAccs = targetAccessories.filter((a) => a.line_id !== moving.line_id);
  const bucketAccs = bucketSelectedAccessories(baseTargetAccs, bucket);
  const orderedIds = bucketAccs.map((a) => a.line_id);
  if (insertBeforeAccId && orderedIds.includes(insertBeforeAccId)) {
    orderedIds.splice(orderedIds.indexOf(insertBeforeAccId), 0, moving.line_id);
  } else {
    orderedIds.push(moving.line_id);
  }

  const nonBucket = baseTargetAccs.filter((a) => !a.selected || accessoryRentSellBucket(a) !== bucket);
  const bucketById = new Map(bucketAccs.map((a) => [a.line_id, a]));
  bucketById.set(moving.line_id, moving);
  const bucketOrdered = orderedIds.map((id) => bucketById.get(id)).filter(Boolean);
  const targetFinalAccs = sortAccessoriesRentThenSell(
    applyAccessoryOrderToList([...nonBucket, ...bucketOrdered], bucket, orderedIds)
  );

  const nextLines = lines.map((l) => {
    if (l.line_id === sourceParentId) {
      return {
        ...l,
        accessories: (l.accessories || []).filter((a) => a.line_id !== dragAcc.line_id),
      };
    }
    if (l.line_id === targetParentId) {
      return { ...l, accessories: targetFinalAccs };
    }
    return l;
  });

  return { ok: true, lines: nextLines };
}

/**
 * Reorder lines via drag-drop within the same section; reassigns display_order.
 * @returns {{ lines: object[], ok: boolean, reason?: string }}
 */
export function reorderBookingLines(lines, dragLineId, dropLineId) {
  const dragId = String(dragLineId || '').trim();
  const dropId = String(dropLineId || '').trim();
  if (!dragId || !dropId || dragId === dropId) return { lines, ok: false };

  const dragLine = (lines || []).find((line) => line.line_id === dragId);
  const dropLine = (lines || []).find((line) => line.line_id === dropId);
  if (!dragLine || !dropLine) return { lines, ok: false };

  const section = lineBookingSection(dragLine);
  if (section !== lineBookingSection(dropLine)) {
    return { lines, ok: false, reason: 'section_mismatch' };
  }

  const ordered = sortLinesByDisplayOrder(linesInSection(lines, section));
  const ids = ordered.map((line) => line.line_id);
  const fromIdx = ids.indexOf(dragId);
  const toIdx = ids.indexOf(dropId);
  if (fromIdx < 0 || toIdx < 0) return { lines, ok: false };

  ids.splice(fromIdx, 1);
  ids.splice(toIdx, 0, dragId);

  const orderById = new Map(ids.map((id, idx) => [id, idx * 10]));
  const idSet = new Set(ids);

  return {
    ok: true,
    lines: (lines || []).map((line) =>
      idSet.has(line.line_id) ? { ...line, display_order: orderById.get(line.line_id) } : line
    ),
  };
}

/**
 * Create Order table: rent products → standalone rent accessories → sale-only products → standalone sell.
 * @param {object[]} lines
 */
export function sortLinesForBookingTable(lines) {
  const rentProducts = [];
  const saleProducts = [];
  const rentStandalone = [];
  const saleStandalone = [];

  for (const line of lines || []) {
    if (line.line_kind === 'standalone_accessory') {
      if (isSellLine(line)) saleStandalone.push(line);
      else rentStandalone.push(line);
      continue;
    }
    if (productLineIsSaleOnly(line)) saleProducts.push(line);
    else rentProducts.push(line);
  }

  return [
    ...sortLinesByDisplayOrder(rentProducts),
    ...sortLinesByDisplayOrder(rentStandalone),
    ...sortLinesByDisplayOrder(saleProducts),
    ...sortLinesByDisplayOrder(saleStandalone),
  ];
}

/** Line amount for bill / checklist (uses line_total when persisted). */
export function billLineTotal(line) {
  const t = line?.total ?? line?.line_total;
  if (t != null && t !== '') return Number(t) || 0;
  const qty = Math.max(1, Number(line?.qty) || 1);
  const price = Number(line?.price) || 0;
  const disc = Number(line?.discount) || 0;
  return Math.max(0, (price - disc) * qty);
}

/** @param {object} row */
export function checklistLineTotal(row) {
  return billLineTotal(row);
}

function indexAccessoriesByItem(accessories) {
  const byItem = new Map();
  const external = [];
  for (const raw of accessories || []) {
    const a = raw;
    const itemId = a.order_item_id ? String(a.order_item_id) : '';
    if (itemId) {
      if (!byItem.has(itemId)) byItem.set(itemId, []);
      byItem.get(itemId).push(a);
    } else {
      external.push(a);
    }
  }
  return { byItem, external };
}

/**
 * Persisted order item: all linked accessories are sell (checklist / process order).
 * @param {object} item
 * @param {Map<string, object[]>} accessoriesByItem
 */
export function orderItemIsSaleOnly(item, accessoriesByItem) {
  const linked = accessoriesByItem.get(String(item.id)) || [];
  if (linked.length === 0) return false;
  return linked.every((a) => isSellLine(a));
}

/**
 * Split persisted order lines for bill rendering (rent vs sale sections).
 * @param {object} order
 */
export function partitionOrderForBill(order) {
  const items = order?.items || [];
  const { byItem: accessoriesByItem, external } = indexAccessoriesByItem(order?.accessories || []);

  const saleItemIds = new Set();
  const rentItems = [];
  const saleItems = [];

  for (const item of items) {
    const linked = accessoriesByItem.get(String(item.id)) || [];
    const allAccessoriesSell = linked.length > 0 && linked.every((a) => isSellLine(a));
    if (isSellLine(item) || allAccessoriesSell) {
      saleItemIds.add(String(item.id));
      saleItems.push(item);
    } else {
      rentItems.push(item);
    }
  }

  const rentAccessoriesByItem = new Map();
  const saleAccessoriesByItem = new Map();
  const saleDetachedFromProducts = [];

  for (const [itemId, list] of accessoriesByItem) {
    if (saleItemIds.has(itemId)) {
      saleAccessoriesByItem.set(itemId, sortAccessoriesByDisplayOrder(list));
      continue;
    }
    const rentAcc = [];
    for (const a of list) {
      if (isSellLine(a)) {
        const parentItem = items.find((i) => String(i.id) === itemId);
        saleDetachedFromProducts.push({ accessory: a, parentItem: parentItem || null });
      } else {
        rentAcc.push(a);
      }
    }
    if (rentAcc.length) rentAccessoriesByItem.set(itemId, sortAccessoriesByDisplayOrder(rentAcc));
  }

  const rentExternal = sortAccessoriesByDisplayOrder(external.filter((a) => !isSellLine(a)));
  const saleExternal = sortAccessoriesByDisplayOrder(external.filter((a) => isSellLine(a)));

  return {
    rentItems: sortLinesByDisplayOrder(rentItems),
    rentAccessoriesByItem,
    rentExternal,
    saleItems: sortLinesByDisplayOrder(saleItems),
    saleAccessoriesByItem,
    saleExternal,
    saleDetachedFromProducts,
  };
}

/**
 * Checklist display order for Process Order / Items checklist modal.
 * Mirrors bill layout: rent products keep rent accessories only; sell accessories
 * from mixed products appear in saleDetachedFromProducts at the bottom.
 * @param {object} order
 */
export function buildChecklistDisplaySections(order) {
  const parts = partitionOrderForBill(order);

  const hasRentSection =
    parts.rentItems.length > 0 ||
    parts.rentAccessoriesByItem.size > 0 ||
    parts.rentExternal.length > 0;
  const hasSaleSection =
    parts.saleItems.length > 0 ||
    parts.saleAccessoriesByItem.size > 0 ||
    parts.saleExternal.length > 0 ||
    parts.saleDetachedFromProducts.length > 0;

  return {
    rentItems: parts.rentItems,
    rentAccessoriesByItem: parts.rentAccessoriesByItem,
    rentStandalone: parts.rentExternal,
    saleItems: parts.saleItems,
    saleAccessoriesByItem: parts.saleAccessoriesByItem,
    saleStandalone: parts.saleExternal,
    saleDetachedFromProducts: parts.saleDetachedFromProducts,
    showSaleDivider: hasRentSection && hasSaleSection,
  };
}

/** Sum line totals for bill subtotals. */
export function sumBillLineTotals(lines) {
  let sum = 0;
  for (const line of lines || []) {
    sum += billLineTotal(line);
  }
  return sum;
}

/**
 * Rent + sale subtotals from a partitioned order (items + nested accessories).
 * @param {ReturnType<typeof partitionOrderForBill>} parts
 */
export function computeRentSaleSubtotalsFromPartition(parts) {
  let rent = 0;
  let sale = 0;

  for (const item of parts.rentItems || []) {
    rent += billLineTotal(item);
  }
  for (const list of parts.rentAccessoriesByItem?.values() || []) {
    rent += sumBillLineTotals(list);
  }
  rent += sumBillLineTotals(parts.rentExternal || []);

  for (const item of parts.saleItems || []) {
    sale += billLineTotal(item);
  }
  for (const list of parts.saleAccessoriesByItem?.values() || []) {
    sale += sumBillLineTotals(list);
  }
  sale += sumBillLineTotals(parts.saleExternal || []);
  for (const row of parts.saleDetachedFromProducts || []) {
    sale += billLineTotal(row.accessory);
  }

  return { rentSubtotal: rent, saleSubtotal: sale };
}

/**
 * @param {object} row
 * @param {'rent'|'sell'|'auto'} [explicitType]
 * @returns {'rent'|'sell'}
 */
export function resolveAccessoryPickerType(row, explicitType) {
  if (explicitType === 'rent' || explicitType === 'sell') return explicitType;
  const t = String(row?.type || row?.default_type || 'rent').toLowerCase();
  return t === 'sell' ? 'sell' : 'rent';
}

/**
 * Qty user can pick in booking accessory modal (rent = date-window free_qty, sell = in shop).
 * @param {object} row
 * @param {'rent'|'sell'|'auto'} [type]
 */
export function accessoryPickerAvailableQty(row, type = 'auto') {
  const mode = resolveAccessoryPickerType(row, type);
  if (mode === 'sell') {
    if (row?.in_shop_qty != null && row?.in_shop_qty !== '') {
      return Math.max(0, Number(row.in_shop_qty) || 0);
    }
    if (row?.rentable_qty != null && row?.rentable_qty !== '') {
      return Math.max(0, Number(row.rentable_qty) || 0);
    }
    return accessoryRentableQty(row);
  }
  if (row?.free_qty != null && row?.free_qty !== '') {
    return Math.max(0, Number(row.free_qty) || 0);
  }
  return 0;
}

/**
 * True when accessory picker should block new selection (matches Add Extra Accessories list).
 * @param {object} row
 * @param {{ type?: 'rent'|'sell'|'auto', grandfatherSelected?: boolean }} [options]
 */
export function isAccessoryPickerOutOfStock(row, options = {}) {
  const type = resolveAccessoryPickerType(row, options.type);
  const avail = accessoryPickerAvailableQty(row, type);
  if (avail > 0) return false;
  if (options.grandfatherSelected) return false;
  return true;
}

/** Only persisted accessories on an edit booking skip out-of-stock blocking. */
export function canGrandfatherAccessorySelection(acc, { isEditMode } = {}) {
  return Boolean(isEditMode && acc?.persisted_id);
}

/** Deselect a product-line accessory row and reset qty for a clean re-add. */
export function deselectAccessoryRow(acc) {
  return { ...acc, selected: false, qty: 1 };
}

/** Re-select a previously deselected accessory row starting at qty 1. */
export function reactivateAccessoryRow(acc, overrides = {}) {
  return { ...acc, ...overrides, selected: true, qty: 1 };
}

/** Overlay live catalog/recommendation availability onto a booking line accessory row. */
export function overlayAccessoryCatalogAvailability(lineRow, catalogRow) {
  if (!catalogRow) return lineRow;
  return {
    ...lineRow,
    free_qty: Number(catalogRow.free_qty ?? lineRow.free_qty ?? 0),
    booked_qty: Number(catalogRow.booked_qty ?? lineRow.booked_qty ?? 0),
    total_qty: Number(catalogRow.total_qty ?? lineRow.total_qty ?? 0),
    spare_qty: Number(catalogRow.spare_qty ?? lineRow.spare_qty ?? 0),
    rentable_qty:
      catalogRow.rentable_qty != null && catalogRow.rentable_qty !== ''
        ? Math.max(0, Number(catalogRow.rentable_qty) || 0)
        : lineRow.rentable_qty,
    in_shop_qty:
      catalogRow.in_shop_qty != null && catalogRow.in_shop_qty !== ''
        ? Math.max(0, Number(catalogRow.in_shop_qty) || 0)
        : lineRow.in_shop_qty,
  };
}

/**
 * @param {object} row
 * @param {{ type?: 'rent'|'sell'|'auto', from?: string, to?: string }} [options]
 */
export function formatAccessoryDateAvailability(row, options = {}) {
  const mode = resolveAccessoryPickerType(row, options.type);
  const total = Math.max(0, Number(row?.total_qty ?? row?.qty ?? 0) || 0);
  const spare = Math.max(0, Number(row?.spare_qty ?? 0) || 0);
  const rentable = Math.max(0, Number(row?.rentable_qty ?? accessoryRentableQty(row)) || 0);
  const booked = Math.max(0, Number(row?.booked_qty ?? 0) || 0);
  const hasDates = Boolean(options.from && options.to);
  const spareLabel = spare > 0 ? ` · ${spare} spare` : '';

  if (mode === 'sell') {
    const inShop = accessoryPickerAvailableQty(row, 'sell');
    const parts = [];
    parts.push(inShop > 0 ? `${inShop} in shop` : 'none in shop');
    if (rentable > 0 && rentable !== total) parts.push(`${rentable} for use`);
    if (spare > 0) parts.push(`${spare} spare`);
    return parts.join(' · ');
  }

  const free = accessoryPickerAvailableQty(row, 'rent');
  if (!hasDates) {
    return spare > 0
      ? `Set delivery and return dates to check availability${spareLabel}`
      : 'Set delivery and return dates to check availability';
  }
  const parts = [];
  parts.push(
    free > 0 ? `${free} available for selected dates` : 'none available for selected dates'
  );
  if (booked > 0) parts.push(`${booked} booked`);
  if (rentable > 0 && (booked > 0 || free !== rentable)) parts.push(`${rentable} for use`);
  if (spare > 0) parts.push(`${spare} spare`);
  return parts.join(' · ');
}
