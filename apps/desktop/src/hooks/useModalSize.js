import { useIsMobileNav } from './useBreakpoint.js';

/** Use full-screen modals on mobile, given size on desktop. */
export function useModalSize(desktopSize) {
  const isMobile = useIsMobileNav();
  return isMobile ? 'full' : desktopSize;
}
