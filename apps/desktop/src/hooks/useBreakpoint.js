import { useEffect, useState } from 'react';

function getMatches(query) {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(query).matches;
}

/**
 * @param {string} query - CSS media query, e.g. '(min-width: 1024px)'
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => getMatches(query));

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Desktop layout: fixed sidebar in document flow (Tailwind lg = 1024px). */
export function useIsLgUp() {
  return useMediaQuery('(min-width: 1024px)');
}

/** Mobile/tablet: drawer nav + compact top bar. */
export function useIsMobileNav() {
  const isLgUp = useIsLgUp();
  return !isLgUp;
}
