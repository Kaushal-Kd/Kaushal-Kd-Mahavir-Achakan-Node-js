/**
 * Next dialog translate while the user is dragging.
 * Unbounded so the modal may leave the viewport; close/reopen resets to 0,0.
 *
 * @param {{ startOffsetX: number, startOffsetY: number, startX: number, startY: number } | null} drag
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{ x: number, y: number } | null}
 */
export function nextModalDragOffset(drag, clientX, clientY) {
  if (!drag) return null;
  return {
    x: drag.startOffsetX + clientX - drag.startX,
    y: drag.startOffsetY + clientY - drag.startY,
  };
}
