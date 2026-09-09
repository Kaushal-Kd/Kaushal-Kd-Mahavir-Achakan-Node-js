import assert from 'node:assert/strict';
import test from 'node:test';

import { putWithProgress } from './uploadRequest.js';

function fakeRequest() {
  return {
    upload: {}, status: 200, sent: 0, aborted: 0, headers: {},
    open(method, url) { this.method = method; this.url = url; },
    setRequestHeader(key, value) { this.headers[key] = value; },
    send(body) { this.body = body; this.sent += 1; },
    abort() { this.aborted += 1; this.onabort?.(); },
  };
}

test('a previously cancelled upload creates no transport and sends no bytes', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(putWithProgress('fixture', 'pdf', 'application/pdf', {
    signal: controller.signal,
    createRequest: () => { assert.fail('cancelled upload must not create XHR'); },
  }), { name: 'AbortError' });
});

test('upload cancellation rejects once, stops progress and aborts the fake request', async () => {
  const xhr = fakeRequest();
  const controller = new AbortController();
  const progress = [];
  const pending = putWithProgress('fixture', 'pdf', 'application/pdf', {
    signal: controller.signal, createRequest: () => xhr, onProgress: (pct) => progress.push(pct),
  });
  xhr.upload.onprogress({ lengthComputable: true, loaded: 1, total: 2 });
  controller.abort();
  xhr.upload.onprogress({ lengthComputable: true, loaded: 2, total: 2 });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(xhr.sent, 1);
  assert.equal(xhr.aborted, 1);
  assert.deepEqual(progress, [50]);
});

test('successful PDF upload preserves MIME/body and releases its abort listener', async () => {
  const xhr = fakeRequest();
  const controller = new AbortController();
  const body = new Blob(['%PDF-fixture']);
  const pending = putWithProgress('fixture', body, 'application/pdf', {
    signal: controller.signal, createRequest: () => xhr,
  });
  xhr.onload();
  await pending;
  assert.equal(xhr.body, body);
  assert.equal(xhr.headers['Content-Type'], 'application/pdf');
  controller.abort();
  assert.equal(xhr.aborted, 0);
});

test('fake HTTP, network and synchronous transport failures are surfaced without retries', async () => {
  for (const failure of ['http', 'network', 'synchronous']) {
    const xhr = fakeRequest();
    if (failure === 'synchronous') xhr.send = () => { throw new Error('transport setup failed'); };
    const pending = putWithProgress('fixture', 'pdf', 'application/pdf', { createRequest: () => xhr });
    if (failure === 'http') { xhr.status = 403; xhr.onload(); }
    if (failure === 'network') xhr.onerror();
    await assert.rejects(pending, /failed|network/);
    assert.ok(xhr.sent <= 1);
  }
});
