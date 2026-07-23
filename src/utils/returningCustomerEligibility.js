/** Booking statuses that indicate a completed rental lifecycle. */
export const QUALIFYING_BOOKING_STATUSES = ['Completed', 'Returned', 'flagged'];

const NON_QUALIFYING_ONLY_STATUSES = new Set([
  'cancelled',
  'canceled',
  'pending_payment',
  'pending_verification',
  'pending_review',
  'rescheduled',
]);

/**
 * Returns true when the booking represents a finished rental (not cancelled-only / in-progress).
 */
export function isQualifyingReturningBooking(booking) {
  if (!booking) return false;

  const status = String(booking.status || '').trim();
  if (!status) return false;

  if (booking.returned_at) return true;

  const statusLower = status.toLowerCase();
  if (QUALIFYING_BOOKING_STATUSES.some((s) => s.toLowerCase() === statusLower)) return true;

  return false;
}

/**
 * Filters bookings to those that qualify a customer as a true returning renter.
 */
export function filterQualifyingReturningBookings(bookings = []) {
  return (bookings || []).filter(isQualifyingReturningBooking);
}

/**
 * True when customer exists and has at least one qualifying completed rental.
 */
export function isTrueReturningCustomer(customer, bookings = []) {
  if (!customer?.id) return false;
  return filterQualifyingReturningBookings(bookings).length > 0;
}

/**
 * Returns qualifying bookings count for display.
 */
export function countQualifyingReturningBookings(bookings = []) {
  return filterQualifyingReturningBookings(bookings).length;
}
