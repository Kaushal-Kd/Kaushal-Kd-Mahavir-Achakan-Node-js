/** @type {number} */
let guardUntil = 0;

/** @type {((e: Event) => void) | null} */
let captureHandler = null;

const GUARD_MS = 450;

function detachCaptureHandler() {
  if (!captureHandler) return;
  document.removeEventListener('click', captureHandler, true);
  document.removeEventListener('mousedown', captureHandler, true);
  captureHandler = null;
}

/** Block the ghost click that often hits table rows right after a modal closes. */
export function armModalCloseGuard() {
  guardUntil = Date.now() + GUARD_MS;
  detachCaptureHandler();

  captureHandler = (e) => {
    if (Date.now() > guardUntil) {
      detachCaptureHandler();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  document.addEventListener('click', captureHandler, true);
  document.addEventListener('mousedown', captureHandler, true);

  window.setTimeout(() => {
    guardUntil = 0;
    detachCaptureHandler();
  }, GUARD_MS);
}

export function isModalCloseGuardActive() {
  return Date.now() < guardUntil;
}
