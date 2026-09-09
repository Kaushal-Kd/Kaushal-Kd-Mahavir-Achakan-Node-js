import { useEffect } from 'react';

import { useUIStore } from '../stores/uiStore.js';

/**
 * Global keyboard shortcuts (requirements §85).
 * - Ctrl/Cmd + Space  -> Global search
 * - Ctrl/Cmd + B      -> Hide / show the side menu
 */
export function useKeyboardShortcuts() {
  const openSearch = useUIStore((s) => s.openSearch);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  useEffect(() => {
    const onKey = (e) => {
      const cmdKey = e.ctrlKey || e.metaKey;
      if (cmdKey && e.code === 'Space') {
        e.preventDefault();
        openSearch();
        return;
      }
      if (cmdKey && !e.shiftKey && !e.altKey && e.code === 'KeyB') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSearch, toggleSidebar]);
}
