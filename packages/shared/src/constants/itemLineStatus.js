/** Per-line physical availability on Item to Collect / Prepare reports. */
export const ITEM_LINE_STATUS = Object.freeze({
  AVAILABLE: 'available',
  NOT_AVAILABLE: 'not_available',
  /** @deprecated Prefer WASHING_QUEUE or IN_WASHING */
  WASHING: 'washing',
  WASHING_QUEUE: 'washing_queue',
  IN_WASHING: 'in_washing',
  WITH_CUSTOMER: 'with_customer',
  COLLECTED_ELSEWHERE: 'collected_elsewhere',
  PREPARED_ELSEWHERE: 'prepared_elsewhere',
  BOOKED_ELSEWHERE: 'booked_elsewhere',
});

export const ITEM_LINE_STATUS_LABELS = Object.freeze({
  available: 'AVAILABLE',
  not_available: 'NOT AVAILABLE',
  washing: 'IN WASHING',
  washing_queue: 'IN WASHING QUEUE',
  in_washing: 'IN WASHING',
  with_customer: 'WITH CUSTOMER',
  collected_elsewhere: 'PREVIOUSLY COLLECTED',
  prepared_elsewhere: 'PREVIOUSLY PREPARED',
  booked_elsewhere: 'PREVIOUSLY BOOKED',
});
