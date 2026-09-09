import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import OfflineBanner from '../OfflineBanner.jsx';

import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';

import { useIsMobileNav } from '../../hooks/useBreakpoint.js';
import { useIdleLogout } from '../../hooks/useIdleLogout.js';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts.js';
import { usePresenceHeartbeat } from '../../hooks/usePresenceHeartbeat.js';
import { useUIStore } from '../../stores/uiStore.js';

const ContentFallback = () => (
  <div className="min-h-[40vh] flex items-center justify-center text-gray-400 text-sm">
    <span className="w-4 h-4 rounded-full border-2 border-brand border-t-transparent animate-spin mr-2" />
    Loading…
  </div>
);

const Layout = () => {
  useKeyboardShortcuts();
  useIdleLogout();
  usePresenceHeartbeat();

  const location = useLocation();
  const isMobileNav = useIsMobileNav();
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const closeMobileNav = useUIStore((s) => s.closeMobileNav);

  useEffect(() => {
    closeMobileNav();
  }, [location.pathname, closeMobileNav]);

  useEffect(() => {
    document.querySelector('.layout-main')?.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobileNav && mobileNavOpen) closeMobileNav();
  }, [isMobileNav, mobileNavOpen, closeMobileNav]);

  return (
    <div className="h-[100dvh] min-h-0 flex flex-col overflow-hidden bg-gray-50">
      <OfflineBanner />
      <div className="flex-1 flex min-h-0 relative">
        {isMobileNav && mobileNavOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-gray-900/50 lg:hidden"
            aria-label="Close menu"
            onClick={closeMobileNav}
          />
        ) : null}
        <Sidebar />
        <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full">
          <TopBar />
          <main className="layout-main">
            <Suspense fallback={<ContentFallback />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  );
};

export default Layout;
