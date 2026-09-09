/** Injectable XHR transport keeps cancellation and progress testable without a cloud upload. */
export function putWithProgress(url, body, contentType, {
  onProgress,
  signal,
  createRequest = () => new XMLHttpRequest(),
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload aborted', 'AbortError'));
      return;
    }
    const xhr = createRequest();
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      finish(new DOMException('Upload aborted', 'AbortError'));
      xhr.abort();
    };
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', contentType);
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (!settled && event.lengthComputable && event.total > 0) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
    }
    xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300
      ? null : new Error(`GCS upload failed (${xhr.status}): ${xhr.responseText || ''}`));
    xhr.onerror = () => finish(new Error('GCS upload network error'));
    xhr.onabort = () => finish(new DOMException('Upload aborted', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try {
      xhr.send(body);
    } catch (error) {
      finish(error);
    }
  });
}
