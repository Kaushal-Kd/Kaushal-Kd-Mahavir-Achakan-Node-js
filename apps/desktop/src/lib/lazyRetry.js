import { lazy } from 'react';

/**
 * Lazy-load a route chunk with one automatic full reload on failure.
 * Fixes "Failed to fetch dynamically imported module" after Vite HMR / dep rebundles.
 */
export function lazyRetry(importFn) {
  return lazy(() =>
    importFn().catch((error) => {
      const key = 'wrs:lazy-import-retry';
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
        return new Promise(() => {});
      }
      sessionStorage.removeItem(key);
      throw error;
    })
  );
}
