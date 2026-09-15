import { lazy } from 'react';

/**
 * Lazy-load a route chunk with one automatic full reload on failure.
 * Fixes "Failed to fetch dynamically imported module" after Vite HMR / dep rebundles.
 */
export function lazyRetry(importFn) {
  const key = 'wrs:lazy-import-retry';
  return lazy(() =>
    importFn()
      .then((mod) => {
        sessionStorage.removeItem(key);
        return mod;
      })
      .catch((error) => {
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
