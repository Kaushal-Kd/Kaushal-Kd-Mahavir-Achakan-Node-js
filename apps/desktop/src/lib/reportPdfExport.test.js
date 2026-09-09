import assert from 'node:assert/strict';
import test from 'node:test';

import { toast } from '../stores/uiStore.js';

import {
  EXPORT_PER_PAGE,
  fetchAllPages,
  fetchAllReportRows,
  omitPagination,
  withExportPdfBusy,
  withListPdfBusy,
} from './reportPdfExport.js';

test('report PDF exports fetch every page while preserving active filters', async () => {
  const params = {
    from: '2026-09-01',
    to: '2026-09-06',
    search: 'Synthetic',
    page: 9,
    per_page: 10,
  };
  const calls = [];
  const rows = await fetchAllReportRows(async (query) => {
    calls.push(query);
    return { data: { rows: [{ id: query.page }], meta: { total_pages: 3 } } };
  }, omitPagination(params));
  assert.deepEqual(rows, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.deepEqual(
    calls.map((query) => query.page),
    [1, 2, 3]
  );
  for (const query of calls) {
    assert.equal(query.per_page, EXPORT_PER_PAGE);
    assert.equal(query.from, params.from);
    assert.equal(query.to, params.to);
    assert.equal(query.search, params.search);
  }
  assert.equal(params.page, 9);
  assert.equal(params.per_page, 10);
});

test('list PDF exports fetch every list page and handle empty results', async () => {
  const rows = await fetchAllPages(async ({ page }) => ({
    data: [{ id: page }],
    meta: { total_pages: '2' },
  }));
  assert.deepEqual(rows, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(await fetchAllPages(async () => ({ data: [], meta: { total_pages: 0 } })), []);
  assert.deepEqual(await fetchAllReportRows(async () => ({ data: { rows: [] } })), []);
});

test('failed later PDF export page rejects instead of returning a partial report', async () => {
  for (const fetchRows of [fetchAllPages, fetchAllReportRows]) {
    const calls = [];
    await assert.rejects(
      fetchRows(async ({ page }) => {
        calls.push(page);
        if (page === 2) throw new Error('Synthetic page failure');
        return fetchRows === fetchAllPages
          ? { data: [{ id: 1 }], meta: { total_pages: 3 } }
          : { data: { rows: [{ id: 1 }], meta: { total_pages: 3 } } };
      }),
      /Synthetic page failure/
    );
    assert.deepEqual(calls, [1, 2]);
  }
});

test('PDF export and print failures notify the user and always release the busy state', async (t) => {
  const errors = [];
  t.mock.method(toast, 'error', (message) => errors.push(message));
  for (const withBusy of [withExportPdfBusy, withListPdfBusy]) {
    const state = [];
    await withBusy(
      (value) => state.push(value),
      async () => {
        throw new Error('Synthetic PDF failure');
      }
    );
    assert.deepEqual(state, [true, false]);
  }
  assert.deepEqual(errors, ['Synthetic PDF failure', 'Synthetic PDF failure']);
});

test('successful PDF export releases the busy state only after completion', async () => {
  const steps = [];
  await withExportPdfBusy(
    (value) => steps.push(value),
    async () => {
      steps.push('completed');
    }
  );
  assert.deepEqual(steps, [true, 'completed', false]);
});
