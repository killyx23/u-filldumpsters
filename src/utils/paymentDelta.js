/**
 * True when a booking has an outstanding payment adjustment
 * (e.g. reschedule delta), not a plain unpaid checkout hold.
 */
export function hasPaymentDelta(booking) {
  const details = booking?.payment_delta_details;
  if (!details) return false;
  return Number(details.amount_due) > 0 || details.state === 'pending';
}

/** Driver’s license, insurance, or vehicle skip — not an address hold. */
export function isLicenseSkipBooking(booking) {
  if (!booking) return false;
  return Boolean(
    booking.was_verification_skipped ||
    booking.addons?.wasVerificationSkipped ||
    booking.addons?.verificationSkipped
  );
}

function hasSchedulingHold(booking) {
  const history = Array.isArray(booking?.reschedule_history) ? booking.reschedule_history : [];
  return history.some(
    (entry) =>
      entry?.status === 'pending' &&
      (entry?.type === 'reschedule_request' || entry?.type === 'address_change')
  );
}

/**
 * The only open hold is the unverified address. License, payment, cancellation,
 * and scheduling requests are separate and stay in their existing queues.
 */
export function isAddressOnlyVerificationBooking(booking) {
  if (!booking?.pending_address_verification) return false;
  if (isLicenseSkipBooking(booking)) return false;
  if (booking.status === 'cancellation_pending') return false;
  if (booking.status === 'pending_payment' && hasPaymentDelta(booking)) return false;
  if (hasSchedulingHold(booking)) return false;
  return true;
}

/**
 * Bookings that belong in Action Items "Pending Verification"
 * (aligned with CustomerDetailView Verification tab).
 * Address-only holds belong on Verify Address, not here.
 */
export function isActionItemVerificationBooking(booking) {
  if (!booking) return false;
  if (isAddressOnlyVerificationBooking(booking)) return false;
  const status = booking.status;
  if (status === 'pending_verification' || status === 'pending_review') return true;
  if (status === 'pending_payment') return hasPaymentDelta(booking);
  return false;
}
