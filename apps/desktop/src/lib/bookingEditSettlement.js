import { round2 } from '@wrs/shared';

/** Preserve partially refunded security unless the operator explicitly edits its controls. */
export function buildBookingEditSettlement(baseline, next) {
  if (!baseline) throw new Error('Reload the booking before editing payments');
  const advanceChanged = round2(next.advance) !== round2(baseline.advance);
  const securityChanged =
    round2(next.depositAmount) !== round2(baseline.depositAmount) ||
    Boolean(next.paid) !== Boolean(baseline.paid);
  if (!advanceChanged && !securityChanged) return undefined;
  return {
    payment_date: next.paymentDate,
    ...(advanceChanged
      ? {
          expected_advance_net: baseline.advance,
          advance_net: round2(next.advance),
          payment_account_id: next.paymentAccountId || null,
        }
      : {}),
    ...(securityChanged
      ? {
          expected_security_net: baseline.securityNet,
          security_net: next.paid ? round2(next.depositAmount) : 0,
          expected_deposit_amount: baseline.depositAmount,
          deposit_amount: round2(next.depositAmount),
          security_account_id: next.securityAccountId || null,
        }
      : {}),
  };
}
