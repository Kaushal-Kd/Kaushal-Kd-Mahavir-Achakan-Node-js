import PropTypes from 'prop-types';
import { useEffect, useRef, useState } from 'react';

import Skeleton from './Skeleton.jsx';

/**
 * Renders children only after the placeholder enters (or nears) the viewport.
 * Defers heavy child queries until the user scrolls to below-fold dashboard sections.
 */
export default function DeferredMount({ children, minHeight = 256, rootMargin = '120px', fallback }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return undefined;
    const node = ref.current;
    if (!node) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, rootMargin]);

  return (
    <div ref={ref} style={{ minHeight: visible ? undefined : minHeight }}>
      {visible ? children : fallback || <Skeleton className="w-full" style={{ height: minHeight }} />}
    </div>
  );
}

DeferredMount.propTypes = {
  children: PropTypes.node,
  minHeight: PropTypes.number,
  rootMargin: PropTypes.string,
  fallback: PropTypes.node,
};
