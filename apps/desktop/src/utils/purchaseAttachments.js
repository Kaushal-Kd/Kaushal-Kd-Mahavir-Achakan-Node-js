export function normalizePurchaseAttachmentUrls(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function flattenPurchaseAttachments(purchases) {
  const items = [];
  (Array.isArray(purchases) ? purchases : []).forEach((purchase) => {
    const urls = normalizePurchaseAttachmentUrls(purchase?.image_urls);
    urls.forEach((url, index) => {
      items.push({
        key: `${purchase?.id || purchase?.purchase_number || 'purchase'}:${index}`,
        url,
        index,
        purchase,
      });
    });
  });
  return items;
}
