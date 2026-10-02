import {
  buildPaymentVoucherNumber,
  maxPrefixedSequence,
  nextDocumentSequence,
} from '@wrs/shared';

export const PAYMENT_VOUCHER_SEQUENCE_KEY = 'payment_voucher.next_sequence';

export function formatPaymentVoucherNumber(sequence, prefix = 'PV') {
  return buildPaymentVoucherNumber({ prefix, sequence });
}

export function nextPaymentVoucherSequenceStart(
  voucherNumbers,
  startSequence = 1,
  prefix = 'PV'
) {
  const fromPrefix = maxPrefixedSequence(voucherNumbers, prefix);
  return nextDocumentSequence(fromPrefix, startSequence);
}
