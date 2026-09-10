import {
  createAccessorySchema,
  createProductSchema,
  normalizeProductCode,
  normalizeProductName,
  resolveFullProductCode,
} from '@wrs/shared';
import AdmZip from 'adm-zip';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import {
  createSignedUploadUrl,
  maybeUploadThumbFromBuffer,
  publicUrlForObjectPath,
  readObjectBuffer,
  uploadObjectBuffer,
} from '../../services/gcs.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';
import { getProductCodeFormat } from '../products/service.js';

const ENTITY_PRODUCT = 'product';
const ENTITY_ACCESSORY = 'accessory';
const VALID_ENTITIES = new Set([ENTITY_PRODUCT, ENTITY_ACCESSORY]);
const IMPORT_STATUS = { processing: 'processing', completed: 'completed', failed: 'failed' };
const CHUNK_SIZE = 300;
const MAX_IMPORT_INSERT_RETRIES = 6;
const COLOR_KEY = 'config.colors';
const SIZE_KEY = 'config.sizes';

const PRODUCT_TEMPLATE_HEADERS = [
  'code',
  'name',
  'type',
  'category_name',
  'qty',
  'price_rent',
  'price_sell',
  'purchase_price',
  'color',
  'size',
  'lifetime_gap',
  'status',
  'vendor_id',
  'main_image',
  'notes',
  'is_active',
];
const ACCESSORY_TEMPLATE_HEADERS = [
  'code',
  'name',
  'category_name',
  'qty',
  'threshold',
  'unit',
  'price_rent',
  'price_sell',
  'purchase_price',
  'default_type',
  'default_order_status',
  'image_url',
  'product_category_names',
  'notes',
  'is_active',
];

export function getImportTemplateCsv(entity) {
  const normalized = normalizeEntity(entity);
  const headers = normalized === ENTITY_PRODUCT ? PRODUCT_TEMPLATE_HEADERS : ACCESSORY_TEMPLATE_HEADERS;
  const sample = normalized === ENTITY_PRODUCT ? buildProductSampleRow() : buildAccessorySampleRow();
  return `${headers.join(',')}\n${sample.join(',')}\n`;
}

export function getProductBulkDeleteTemplateCsv() {
  return 'code\nS-0001[32]\n';
}

export async function uploadImportCsv(shopId, userId, entity, fileName, csvText, options = {}) {
  const normalized = normalizeEntity(entity);
  const safeName = String(fileName || '').trim().slice(0, 255) || `${normalized}_bulk_upload.csv`;
  const safeCsv = String(csvText || '');
  if (!safeCsv.trim()) throw badRequest('CSV content is required');

  const allowAutoCreateMissing = !!options.allow_auto_create_missing;
  const confirmCreateMissing = !!options.confirm_create_missing;
  const autoGenerateMissingCodes = options.auto_generate_missing_codes !== false;
  const imagesZipObjectPath = String(options.images_zip_object_path || '').trim();
  const parsed = parseCsvText(safeCsv);
  if (!parsed.rows.length) throw badRequest('CSV has no data rows');
  let zipImageMap = null;
  if (imagesZipObjectPath) {
    zipImageMap = await loadImagesZipMap(imagesZipObjectPath);
  }

  resolveImportImageFields(parsed.rows, normalized, zipImageMap);

  const prep =
    normalized === ENTITY_PRODUCT
      ? await prepareProductRows(shopId, parsed.rows, { autoGenerateMissingCodes })
      : await prepareAccessoryRows(shopId, parsed.rows, { autoGenerateMissingCodes });

  const missing = buildMissingSummary(prep);
  const hasMissing =
    missing.missing_product_categories.length > 0 ||
    missing.missing_accessory_categories.length > 0 ||
    missing.missing_colors.length > 0 ||
    missing.missing_sizes.length > 0;

  if (hasMissing && (!allowAutoCreateMissing || !confirmCreateMissing)) {
    return {
      mode: 'preview',
      entity: normalized,
      requires_confirmation: true,
      ...missing,
      summary: {
        total_rows: parsed.rows.length,
        valid_candidate_rows: prep.candidates.length,
        failed_rows: prep.errors.length,
      },
    };
  }

  const jobId = uuid();
  await knex('import_jobs').insert({
    id: jobId,
    shop_id: shopId,
    created_by: userId || null,
    entity: normalized,
    file_name: safeName,
    status: IMPORT_STATUS.processing,
    total_rows: parsed.rows.length,
    started_at: knex.fn.now(),
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  try {
    if (hasMissing) {
      // Confirmation-gated creation of missing master values.
      await createMissingMasters(shopId, normalized, prep);
      // Re-prepare after creating missing values to resolve ids/config lists.
      const reparsed =
        normalized === ENTITY_PRODUCT
          ? await prepareProductRows(shopId, parsed.rows, { autoGenerateMissingCodes })
          : await prepareAccessoryRows(shopId, parsed.rows, { autoGenerateMissingCodes });
      prep.candidates = reparsed.candidates;
      prep.errors = reparsed.errors;
    }

    const result =
      normalized === ENTITY_PRODUCT
        ? await processPreparedProducts(shopId, prep.candidates, prep.errors, {
            onProgress: (progress) => updateImportJobProgress(jobId, parsed.rows.length, progress),
          })
        : await processPreparedAccessories(shopId, prep.candidates, prep.errors, {
            onProgress: (progress) => updateImportJobProgress(jobId, parsed.rows.length, progress),
          });

    if (result.errors.length) await insertErrors(jobId, result.errors);
    await knex('import_jobs')
      .where({ id: jobId })
      .update({
        status: IMPORT_STATUS.completed,
        total_rows: parsed.rows.length,
        success_rows: result.successRows,
        failed_rows: result.failedRows,
        error_count: result.errors.length,
        summary_message: `Imported ${result.successRows}/${parsed.rows.length}`,
        finished_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });

    return {
      mode: 'imported',
      job_id: jobId,
      entity: normalized,
      total_rows: parsed.rows.length,
      success_rows: result.successRows,
      failed_rows: result.failedRows,
      error_count: result.errors.length,
      ...missing,
    };
  } catch (err) {
    await knex('import_jobs')
      .where({ id: jobId })
      .update({
        status: IMPORT_STATUS.failed,
        summary_message: String(err?.message || 'Import failed').slice(0, 500),
        finished_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
    throw err;
  }
}

export async function listImportJobs(shopId, query = {}) {
  const qb = knex('import_jobs as j')
    .leftJoin('users as u', 'u.id', 'j.created_by')
    .where({ 'j.shop_id': shopId })
    .select('j.*', 'u.name as created_by_name');
  if (query.entity) qb.andWhere('j.entity', normalizeEntity(query.entity));
  return paginate(qb, {
    page: query.page,
    per_page: query.per_page || 20,
    search: query.search,
    sort: query.sort || '-j.created_at',
    search_fields: ['j.file_name', 'u.name', 'j.status', 'j.entity'],
  });
}

export async function getImportErrorExport(shopId, jobId) {
  const job = await knex('import_jobs').where({ id: jobId, shop_id: shopId }).first();
  if (!job) throw notFound('Import job not found');
  const rows = await knex('import_job_errors')
    .where({ job_id: jobId })
    .orderBy('row_number')
    .select('row_number', 'entity_code', 'error_message', 'row_payload');
  const csv = [
    'row_number,entity_code,error_message,row_payload',
    ...rows.map((r) =>
      [r.row_number, escapeCsv(r.entity_code || ''), escapeCsv(r.error_message || ''), escapeCsv(r.row_payload || '')].join(',')
    ),
  ].join('\n');
  return { file_name: `import_errors_${job.entity}_${job.id}.csv`, csv: `${csv}\n`, total_errors: rows.length };
}

function normalizeEntity(entity) {
  const normalized = String(entity || '').trim().toLowerCase();
  if (!VALID_ENTITIES.has(normalized)) throw badRequest('Unsupported import entity');
  return normalized;
}

async function prepareProductRows(shopId, csvRows, options = {}) {
  const seenInFile = new Set();
  const errors = [];
  const candidates = [];
  const existingCodes = await loadExistingCodes(shopId, 'products', csvRows);
  const productCategories = await loadCategoryLabelMap(shopId, 'product');
  const autoGenerateMissingCodes = options.autoGenerateMissingCodes !== false;
  const codeAllocator = autoGenerateMissingCodes
    ? await createCodeAllocator(shopId, ENTITY_PRODUCT, seenInFile)
    : null;

  for (const row of csvRows) {
    if (row.data?.__image_lookup_error) {
      errors.push(
        makeRowError(
          row.row_number,
          row.data?.code || null,
          row.data.__image_lookup_error,
          row.data
        )
      );
      continue;
    }
    const payload = buildProductPayload(row.data);
    let codeGenerated = false;
    let code = resolveFullProductCode(payload.code || '', payload.size);
    if (!code) {
      if (!autoGenerateMissingCodes || !codeAllocator) {
        errors.push(makeRowError(row.row_number, null, 'Product code is required', row.data));
        continue;
      }
      code = codeAllocator.next();
      codeGenerated = true;
    }
    payload.code = code;
    if (seenInFile.has(code)) {
      errors.push(makeRowError(row.row_number, code, 'Duplicate code in same file', row.data));
      continue;
    }
    seenInFile.add(code);
    if (existingCodes.has(code)) {
      errors.push(makeRowError(row.row_number, code, 'Product code already exists', row.data));
      continue;
    }

    const categoryName = normalizeLower(payload.category_name);
    if (categoryName) {
      payload.category_id = productCategories.get(categoryName) || null;
    }
    delete payload.category_name;

    const parsed = createProductSchema.safeParse({ ...payload, code, shop_id: shopId });
    if (!parsed.success) {
      errors.push(makeRowError(row.row_number, code, parsed.error.issues[0]?.message || 'Invalid row', row.data));
      continue;
    }
    candidates.push({
      row_number: row.row_number,
      code,
      generated_code: codeGenerated,
      category_name: categoryName || null,
      color: normalizeLower(parsed.data.color),
      size: normalizeLower(parsed.data.size),
      data: parsed.data,
      raw: row.data,
    });
  }

  const missing_product_categories = uniq(
    candidates
      .filter((c) => c.category_name && !c.data.category_id)
      .map((c) => c.category_name)
  );
  const missing_colors = uniq(candidates.map((c) => c.color).filter(Boolean));
  const missing_sizes = uniq(candidates.map((c) => c.size).filter(Boolean));

  const existingColors = await getSettingsList(shopId, COLOR_KEY);
  const existingSizes = await getSettingsList(shopId, SIZE_KEY);

  return {
    candidates,
    errors,
    missing_product_categories,
    missing_accessory_categories: [],
    missing_colors: missing_colors.filter((v) => !existingColors.has(v)),
    missing_sizes: missing_sizes.filter((v) => !existingSizes.has(v)),
  };
}

async function prepareAccessoryRows(shopId, csvRows) {
  const errors = [];
  const candidates = [];
  const accessoryCategories = await loadCategoryLabelMap(shopId, 'accessory');
  const productCategories = await loadCategoryLabelMap(shopId, 'product');

  for (const row of csvRows) {
    if (row.data?.__image_lookup_error) {
      errors.push(
        makeRowError(
          row.row_number,
          row.data?.code || null,
          row.data.__image_lookup_error,
          row.data
        )
      );
      continue;
    }
    const payload = buildAccessoryPayload(row.data);
    if (payload.threshold === undefined) payload.threshold = 5;

    const categoryName = normalizeLower(payload.category_name);
    if (categoryName) payload.category_id = accessoryCategories.get(categoryName) || null;
    delete payload.category_name;

    delete payload.product_category_names;

    const parsed = createAccessorySchema.safeParse({ ...payload, shop_id: shopId });
    if (!parsed.success) {
      errors.push(makeRowError(row.row_number, null, parsed.error.issues[0]?.message || 'Invalid row', row.data));
      continue;
    }
    candidates.push({
      row_number: row.row_number,
      category_name: categoryName || null,
      data: parsed.data,
      raw: row.data,
    });
  }

  const missing_accessory_categories = uniq(
    candidates
      .filter((c) => c.category_name && !c.data.category_id)
      .map((c) => c.category_name)
  );
  return {
    candidates,
    errors,
    missing_product_categories: [],
    missing_accessory_categories,
    missing_colors: [],
    missing_sizes: [],
  };
}

function buildMissingSummary(prep) {
  return {
    missing_product_categories: prep.missing_product_categories || [],
    missing_accessory_categories: prep.missing_accessory_categories || [],
    missing_colors: prep.missing_colors || [],
    missing_sizes: prep.missing_sizes || [],
  };
}

async function createMissingMasters(shopId, entity, prep) {
  if (prep.missing_product_categories?.length) {
    await insertCategoryLabels(shopId, 'product', prep.missing_product_categories);
  }
  if (prep.missing_accessory_categories?.length) {
    await insertCategoryLabels(shopId, 'accessory', prep.missing_accessory_categories);
  }
  if (entity === ENTITY_PRODUCT) {
    if (prep.missing_colors?.length) await appendSettingsList(shopId, COLOR_KEY, prep.missing_colors);
    if (prep.missing_sizes?.length) await appendSettingsList(shopId, SIZE_KEY, prep.missing_sizes);
  }
}

async function processPreparedProducts(shopId, candidates, existingErrors, options = {}) {
  const rows = candidates.map((c) => ({
    ...c.data,
    id: uuid(),
    code: c.code,
    color: c.color || c.data.color || null,
    size: c.size || c.data.size || null,
    photos: JSON.stringify(Array.isArray(c.data.photos) ? c.data.photos : []),
    _generatedCode: !!c.generated_code,
    _rowNumber: c.row_number,
    _raw: c.raw,
  }));
  const { successRows, insertErrors } = await insertRowsWithCodeRetry(
    shopId,
    ENTITY_PRODUCT,
    rows,
    'products',
    options
  );
  const errors = [...existingErrors, ...insertErrors];
  return { successRows, failedRows: errors.length, errors };
}

async function processPreparedAccessories(shopId, candidates, existingErrors, options = {}) {
  const accessoryRows = [];
  for (const c of candidates) {
    const accessoryId = uuid();
    const accessoryData = c.data;
    accessoryRows.push({
      ...accessoryData,
      id: accessoryId,
      _rowNumber: c.row_number,
      _raw: c.raw,
    });
  }
  const { successRows, insertErrors, insertedIds } = await insertRowsWithCodeRetry(
    shopId,
    ENTITY_ACCESSORY,
    accessoryRows,
    'accessories',
    options
  );
  const errors = [...existingErrors, ...insertErrors];
  return { successRows, failedRows: errors.length, errors };
}

async function loadExistingCodes(shopId, table, csvRows) {
  const targets = new Set(
    csvRows
      .map((r) => resolveFullProductCode(r.data?.code, r.data?.size))
      .filter(Boolean)
  );
  if (!targets.size) return new Set();

  const existing = new Set();
  const rows = await knex(table).where({ shop_id: shopId }).select('code', 'size');
  for (const row of rows) {
    const resolved = resolveFullProductCode(row.code, row.size);
    if (resolved && targets.has(resolved)) existing.add(resolved);
  }
  return existing;
}

async function loadCategoryLabelMap(shopId, type) {
  const rows = await knex('categories')
    .where({ shop_id: shopId, is_active: true, category_type: type })
    .select('id', 'label');
  const out = new Map();
  rows.forEach((r) => {
    const k = normalizeLower(r.label);
    if (k) out.set(k, r.id);
  });
  return out;
}

async function insertCategoryLabels(shopId, type, labels) {
  const existing = await loadCategoryLabelMap(shopId, type);
  const rows = [];
  for (const label of labels) {
    const v = normalizeLower(label);
    if (!v || existing.has(v)) continue;
    rows.push({ id: uuid(), shop_id: shopId, label: v, category_type: type, sort_order: 0, is_active: true });
    existing.set(v, 'x');
  }
  await insertInChunks('categories', rows);
}

async function getSettingsList(shopId, key) {
  const row = await knex('settings').where({ shop_id: shopId, key }).first();
  const parsed = parseJsonSafe(row?.value);
  const values = Array.isArray(parsed) ? parsed : [];
  return new Set(values.map((v) => normalizeLower(v)).filter(Boolean));
}

async function appendSettingsList(shopId, key, additions) {
  const row = await knex('settings').where({ shop_id: shopId, key }).first();
  const current = Array.isArray(parseJsonSafe(row?.value)) ? parseJsonSafe(row?.value) : [];
  const map = new Map();
  current.forEach((v) => {
    const n = normalizeLower(v);
    if (n) map.set(n, n);
  });
  additions.forEach((v) => {
    const n = normalizeLower(v);
    if (n) map.set(n, n);
  });
  const next = Array.from(map.values());
  if (row) {
    await knex('settings').where({ id: row.id }).update({ value: JSON.stringify(next), updated_at: knex.fn.now() });
  } else {
    await knex('settings').insert({
      id: uuid(),
      shop_id: shopId,
      key,
      value: JSON.stringify(next),
      updated_at: knex.fn.now(),
    });
  }
}

async function insertErrors(jobId, errors) {
  const rows = errors.map((e) => ({
    id: uuid(),
    job_id: jobId,
    row_number: e.row_number,
    entity_code: e.entity_code || null,
    error_message: e.error_message,
    row_payload: e.row_payload,
  }));
  await insertInChunks('import_job_errors', rows);
}

async function insertInChunks(table, rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const batch = rows.slice(i, i + CHUNK_SIZE);
    // eslint-disable-next-line no-await-in-loop
    await knex(table).insert(batch);
  }
}

async function loadImagesZipMap(objectPath) {
  const zipBuffer = await readObjectBuffer(objectPath);
  const zip = new AdmZip(zipBuffer);
  const out = new Map();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const fileName = String(entry.entryName || '')
      .split('/')
      .pop();
    const normalizedName = normalizeLower(fileName);
    if (!normalizedName) continue;
    const ext = normalizedName.split('.').pop();
    if (!ext || !['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) continue;
    const fileBuffer = entry.getData();
    const mime = mimeByExt(ext);
    const uploaded = await uploadImageBuffer(fileBuffer, {
      folder: 'imports/images',
      contentType: mime,
    });
    out.set(normalizedName, uploaded.publicUrl);
  }
  return out;
}

function resolveImportImageFields(rows, entity, zipMap) {
  const imageKey = entity === ENTITY_PRODUCT ? 'main_image' : 'image_url';
  const hasZip = zipMap && zipMap.size > 0;
  for (const row of rows) {
    const original = String(row.data?.[imageKey] || '').trim();
    if (!original) continue;
    if (isHttpUrl(original)) {
      row.data[imageKey] = original;
      continue;
    }
    if (!hasZip) {
      row.data.__image_lookup_error = `Image "${original}" requires a ZIP upload, or use a full image URL in ${imageKey}`;
      continue;
    }
    const mappedUrl = zipMap.get(normalizeLower(original));
    if (mappedUrl) {
      row.data[imageKey] = mappedUrl;
      continue;
    }
    row.data.__image_lookup_error = `Image file "${original}" was not found in ZIP`;
  }
}

async function uploadImageBuffer(buffer, { folder, contentType }) {
  const { objectPath } = await createSignedUploadUrl({
    folder,
    shopId: 'imports',
    contentType,
  });
  await uploadObjectBuffer(objectPath, buffer, contentType);
  await maybeUploadThumbFromBuffer(objectPath, buffer);
  return { objectPath, publicUrl: publicUrlForObjectPath(objectPath) };
}

async function createCodeAllocator(shopId, entity, seenCodes) {
  if (entity !== ENTITY_PRODUCT) {
    return {
      next() {
        return '';
      },
    };
  }
  const table = 'products';
  const fmt = await getProductCodeFormat(shopId);
  const prefix = normalizeProductCode(fmt.default_prefix || '');
  const padding = Math.max(1, Number(fmt.padding || 4));
  const rows = await knex(table).where({ shop_id: shopId }).select('code');
  let maxNum = 0;
  const matcher = new RegExp(`^${escapeRegex(prefix)}(\\d+)$`, 'i');
  const usedCodes = new Set();
  for (const row of rows) {
    const code = normalizeProductCode(row.code);
    if (!code) continue;
    usedCodes.add(code);
    const match = matcher.exec(code);
    if (!match) continue;
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n) && n > maxNum) maxNum = n;
  }
  let nextNumber = maxNum + 1;
  return {
    next() {
      let candidate = normalizeProductCode(`${prefix}${String(nextNumber).padStart(padding, '0')}`);
      while (usedCodes.has(candidate) || seenCodes.has(candidate)) {
        nextNumber += 1;
        candidate = `${prefix}${String(nextNumber).padStart(padding, '0')}`;
      }
      usedCodes.add(candidate);
      nextNumber += 1;
      return candidate;
    },
  };
}

async function insertRowsWithCodeRetry(shopId, entity, rows, table, options = {}) {
  const insertErrors = [];
  const insertedIds = [];
  let successRows = 0;
  let processedRows = 0;
  let lastProgressAt = 0;
  const usesCodeRetry = entity === ENTITY_PRODUCT;
  const allocator = usesCodeRetry
    ? await createCodeAllocator(shopId, entity, new Set(rows.map((r) => normalizeProductCode(r.code))))
    : null;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const batch = rows.slice(i, i + CHUNK_SIZE);
    try {
      // eslint-disable-next-line no-await-in-loop
      await knex(table).insert(batch.map(stripInternalRowFields));
      successRows += batch.length;
      processedRows += batch.length;
      batch.forEach((row) => insertedIds.push(row.id));
    } catch {
      for (const row of batch) {
        let attempts = 0;
        let inserted = false;
        while (!inserted && attempts < MAX_IMPORT_INSERT_RETRIES) {
          attempts += 1;
          try {
            // eslint-disable-next-line no-await-in-loop
            await knex(table).insert(stripInternalRowFields(row));
            inserted = true;
            successRows += 1;
            processedRows += 1;
            insertedIds.push(row.id);
          } catch (error) {
            if (usesCodeRetry && isUniqueCodeError(error) && row._generatedCode) {
              row.code = allocator.next();
              continue;
            }
            insertErrors.push(
              makeRowError(
                row._rowNumber,
                row.code,
                error?.message || 'Insert failed',
                row._raw || { code: row.code, name: row.name || '' }
              )
            );
            processedRows += 1;
            break;
          }
        }
        if (!inserted && usesCodeRetry && row._generatedCode && attempts >= MAX_IMPORT_INSERT_RETRIES) {
          insertErrors.push(
            makeRowError(
              row._rowNumber,
              row.code,
              'Could not allocate a unique code after retries',
              row._raw || { code: row.code, name: row.name || '' }
            )
          );
          processedRows += 1;
        }
      }
    }
    if (typeof options.onProgress === 'function') {
      const shouldEmit = processedRows - lastProgressAt >= CHUNK_SIZE || processedRows === rows.length;
      if (shouldEmit) {
        lastProgressAt = processedRows;
        // eslint-disable-next-line no-await-in-loop
        await options.onProgress({
          processed_rows: processedRows,
          success_rows: successRows,
          failed_rows: insertErrors.length,
        });
      }
    }
  }
  return { successRows, insertErrors, insertedIds };
}

async function updateImportJobProgress(jobId, totalRows, progress) {
  const processed = Number(progress?.processed_rows || 0);
  const success = Number(progress?.success_rows || 0);
  const failed = Number(progress?.failed_rows || 0);
  await knex('import_jobs')
    .where({ id: jobId })
    .update({
      total_rows: totalRows,
      success_rows: success,
      failed_rows: failed,
      summary_message: `Processing ${processed}/${totalRows}`,
      updated_at: knex.fn.now(),
    });
}

function stripInternalRowFields(row) {
  const { _generatedCode, _raw, _rowNumber, ...clean } = row;
  return clean;
}

function isUniqueCodeError(error) {
  const msg = String(error?.sqlMessage || error?.message || '').toLowerCase();
  return msg.includes('duplicate') && msg.includes('code');
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function mimeByExt(ext) {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'application/octet-stream';
}

function makeRowError(rowNumber, code, message, raw) {
  return {
    row_number: rowNumber,
    entity_code: normalizeLower(code) || null,
    error_message: String(message || 'Invalid row').slice(0, 1000),
    row_payload: JSON.stringify(raw || {}),
  };
}

function buildProductPayload(raw) {
  const out = {};
  assignNormalizedCodeIfPresent(out, 'code', raw.code);
  assignNormalizedNameIfPresent(out, 'name', raw.name);
  assignIfPresent(out, 'type', raw.type);
  assignLowerIfPresent(out, 'category_name', raw.category_name);
  assignIfPresent(out, 'qty', raw.qty);
  assignIfPresent(out, 'price_rent', raw.price_rent);
  assignIfPresent(out, 'price_sell', raw.price_sell);
  assignIfPresent(out, 'purchase_price', raw.purchase_price);
  assignLowerIfPresent(out, 'color', raw.color);
  assignLowerIfPresent(out, 'size', raw.size);
  assignIfPresent(out, 'lifetime_gap', raw.lifetime_gap);
  assignIfPresent(out, 'status', raw.status);
  assignIfPresent(out, 'vendor_id', raw.vendor_id);
  assignIfPresent(out, 'main_image', raw.main_image);
  assignIfPresent(out, 'notes', raw.notes);
  if (raw.is_active !== undefined) out.is_active = toBoolean(raw.is_active);
  return out;
}

function buildAccessoryPayload(raw) {
  const out = {};
  assignIfPresent(out, 'name', raw.name);
  assignLowerIfPresent(out, 'category_name', raw.category_name);
  assignIfPresent(out, 'qty', raw.qty);
  assignIfPresent(out, 'threshold', raw.threshold);
  assignIfPresent(out, 'unit', raw.unit);
  assignIfPresent(out, 'price_rent', raw.price_rent);
  assignIfPresent(out, 'price_sell', raw.price_sell);
  assignIfPresent(out, 'purchase_price', raw.purchase_price);
  assignIfPresent(out, 'default_type', raw.default_type);
  assignIfPresent(out, 'default_order_status', raw.default_order_status);
  assignIfPresent(out, 'image_url', raw.image_url);
  assignIfPresent(out, 'notes', raw.notes);
  if (raw.is_active !== undefined) out.is_active = toBoolean(raw.is_active);
  out.product_category_names = toLowerList(raw.product_category_names);
  return out;
}

function assignIfPresent(target, key, value) {
  if (value === undefined || value === null) return;
  const s = typeof value === 'string' ? value.trim() : value;
  if (s === '') return;
  target[key] = s;
}

function assignNormalizedCodeIfPresent(target, key, value) {
  const v = normalizeProductCode(value);
  if (!v) return;
  target[key] = v;
}

function assignNormalizedNameIfPresent(target, key, value) {
  const v = normalizeProductName(value);
  if (!v) return;
  target[key] = v;
}

function assignLowerIfPresent(target, key, value) {
  const v = normalizeLower(value);
  if (!v) return;
  target[key] = v;
}

function normalizeLower(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return s || '';
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toBoolean(value) {
  const s = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return Boolean(value);
}

function toLowerList(value) {
  const s = String(value || '').trim();
  if (!s) return [];
  return uniq(
    s
      .split('|')
      .map((v) => normalizeLower(v))
      .filter(Boolean)
  );
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function parseCsvText(csvText) {
  const lines = String(csvText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l, idx, arr) => !(idx === arr.length - 1 && l.trim() === ''));
  if (!lines.length) throw badRequest('CSV is empty');
  const headers = parseCsvLine(lines[0]).map((h) => String(h || '').trim().toLowerCase());
  if (!headers.length) throw badRequest('CSV header row is required');
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    if (cols.every((c) => String(c || '').trim() === '')) continue;
    const data = {};
    headers.forEach((h, idx) => {
      data[h] = cols[idx] !== undefined ? String(cols[idx]).trim() : '';
    });
    rows.push({ row_number: i + 1, data });
  }
  return { headers, rows };
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseJsonSafe(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildProductSampleRow() {
  return [
    'prd001',
    'sherwani gold',
    'rent',
    'sherwani',
    '5',
    '2500',
    '7000',
    '5000',
    'gold',
    'l',
    '2',
    'available',
    '',
    'https://example.com/product.jpg',
    'sample note',
    'true',
  ];
}

function buildAccessorySampleRow() {
  return [
    'acc001',
    'pagdi brooch',
    'brooch',
    '40',
    '5',
    'pcs',
    '50',
    '150',
    '90',
    'sell',
    'regular',
    'https://example.com/accessory.jpg',
    'sherwani|kurta',
    'sample note',
    'true',
  ];
}

function escapeCsv(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
