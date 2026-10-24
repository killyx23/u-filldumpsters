const UNFINISHED_UNPAID_STATUSES = new Set(['pending_payment', 'booking_not_finished']);

/** Checkout started or abandoned, with no payment taken. */
export function isUnfinishedUnpaidBooking(booking) {
  const status = String(booking?.status || '').trim().toLowerCase();
  return UNFINISHED_UNPAID_STATUSES.has(status);
}
