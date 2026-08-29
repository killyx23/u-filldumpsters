/**
 * True when a booking has an outstanding payment adjustment
 * (e.g. reschedule delta), not a plain unpaid checkout hold.
 */
export function hasPaymentDelta(booking) {
  const details = booking?.payment_delta_details;
  if (!details) return false;
  return Number(details.amount_due) > 0 || details.state === 'pending';
}

/**
 * Bookings that belong in Action Items "Pending Verification"
 * (aligned with CustomerDetailView Verification tab).
 */
export function isActionItemVerificationBooking(booking) {
  if (!booking || booking.pending_address_verification) return false;
  const status = booking.status;
  if (status === 'pending_verification' || status === 'pending_review') return true;
  if (status === 'pending_payment') return hasPaymentDelta(booking);
  return false;
}
