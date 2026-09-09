export function restorePaymentVoucherBillAllocation(bill, billKind, originalAmount) {
  const amount = Math.max(0, Number(originalAmount || 0));
  if (billKind === 'washing') {
    return { ...bill, washing_balance: Math.max(0, Number(bill?.washing_balance || 0)) + amount };
  }
  return { ...bill, advance: Math.max(0, Number(bill?.advance || 0) - amount) };
}
