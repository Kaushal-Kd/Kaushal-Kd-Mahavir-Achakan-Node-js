export const FLYOUT_GAP = 6;
export const FLYOUT_MAX_HEIGHT = 360;

export function flyoutStyle(rect, { maxHeight = FLYOUT_MAX_HEIGHT, gap = FLYOUT_GAP, viewportHeight } = {}) {
  const vh = viewportHeight ?? (typeof window === 'undefined' ? 800 : window.innerHeight);
  const height = Math.min(maxHeight, Math.max(80, vh - 16));
  let top = rect.top;
  if (top + height > vh - 8) top = Math.max(8, vh - 8 - height);
  return {
    top,
    left: rect.right + gap,
    maxHeight: height,
  };
}
