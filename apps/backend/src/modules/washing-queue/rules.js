export function shouldQueueAccessoryForWashing(accessory) {
  return Boolean(accessory?.id && accessory?.is_washable);
}
