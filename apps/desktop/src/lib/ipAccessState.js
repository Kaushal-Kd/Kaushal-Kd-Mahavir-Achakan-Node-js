export const IP_VALIDATION_RETRY_DELAY_MS = 5_000;
export const IP_VALIDATION_MAX_AUTO_RETRIES = 3;

export function shouldBlockForIpValidation({ hasToken, restricted, online, validationPending }) {
  return Boolean(hasToken && restricted && (!online || validationPending));
}

export function shouldWaitForRestrictedBootstrap({ hasToken, hasUser, restricted }) {
  return Boolean(hasToken && (!hasUser || restricted));
}

export function shouldScheduleIpValidationRetry({
  hasToken,
  restricted,
  online,
  validationPending,
  automaticRetries,
}) {
  return Boolean(
    hasToken &&
    restricted &&
    online &&
    validationPending &&
    automaticRetries < IP_VALIDATION_MAX_AUTO_RETRIES
  );
}
