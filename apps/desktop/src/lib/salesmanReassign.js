/**
 * @param {Map<string, { id: string, order_id: string }>} selectedLines
 * @returns {Map<string, string[]>}
 */
export function groupSelectedLinesByOrder(selectedLines) {
  const byOrder = new Map();
  for (const line of selectedLines.values()) {
    const oid = String(line.order_id || '');
    const id = String(line.id || '');
    if (!oid || !id) continue;
    if (!byOrder.has(oid)) byOrder.set(oid, []);
    byOrder.get(oid).push(id);
  }
  return byOrder;
}

/**
 * @param {{
 *   selectedLines: Map<string, { id: string, order_id: string }>,
 *   salesPersonId: string,
 *   selectedPreview?: Array<{ order_id?: string, order_number?: string }>,
 *   pendingOrderIds?: Set<string>,
 *   submit: (orderId: string, payload: object, metadata: object) => Promise<{ queued?: boolean }>,
 * }} opts
 */
export async function submitSalesmanReassignment({
  selectedLines,
  salesPersonId,
  selectedPreview = [],
  pendingOrderIds,
  submit,
}) {
  if (!salesPersonId) throw new Error('Select a salesman');
  if (pendingOrderIds) {
    const hasPending = [...selectedLines.values()].some((line) =>
      pendingOrderIds.has(String(line.order_id))
    );
    if (hasPending) {
      throw new Error('Review the selected booking in Pending sync before transferring its work.');
    }
  }
  const byOrder = groupSelectedLinesByOrder(selectedLines);
  if (!byOrder.size) throw new Error('Select at least one product line');
  let queued = 0;
  for (const [orderId, itemIds] of byOrder) {
    const orderNumber = selectedPreview.find((row) => String(row.order_id) === orderId)?.order_number;
    const result = await submit(
      orderId,
      { order_item_ids: itemIds, sales_person_id: salesPersonId },
      { orderNumber }
    );
    if (result?.queued) queued += 1;
  }
  return { lineCount: selectedLines.size, queued };
}
