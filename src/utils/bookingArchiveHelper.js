/**
 * Build archive_details payload for cancelled/rescheduled bookings.
 */
export function buildArchiveDetails({
  action,
  initiatedBy,
  adminEmail,
  booking,
  stripeChargeId,
  notes,
  rescheduledToBookingId,
}) {
  return {
    action,
    action_at: new Date().toISOString(),
    initiated_by: initiatedBy,
    admin_email: adminEmail ?? null,
    original_created_at: booking.created_at,
    original_total_price: booking.total_price,
    stripe_charge_id: stripeChargeId,
    notes: notes ?? null,
    ...(rescheduledToBookingId != null ? { rescheduled_to_booking_id: rescheduledToBookingId } : {}),
  };
}

export function getStripeChargeId(booking) {
  const paymentInfo = Array.isArray(booking.stripe_payment_info)
    ? booking.stripe_payment_info[0]
    : booking.stripe_payment_info;
  return paymentInfo?.stripe_charge_id || booking.payment_intent || booking.client_secret || 'N/A';
}

export function getInitiatedByLabel(archiveDetails) {
  if (!archiveDetails) return null;
  const { action, initiated_by: initiatedBy, admin_email: adminEmail } = archiveDetails;
  if (action === 'cancelled') {
    return initiatedBy === 'customer'
      ? 'Canceled by customer'
      : `Canceled by admin${adminEmail ? ` (${adminEmail})` : ''}`;
  }
  if (action === 'rescheduled') {
    return initiatedBy === 'customer'
      ? 'Rescheduled on behalf of customer'
      : `Rescheduled manually by admin${adminEmail ? ` (${adminEmail})` : ''}`;
  }
  return null;
}

export const ARCHIVED_STATUSES = new Set([
  'Completed',
  'flagged',
  'Cancelled',
  'Rescheduled',
  'booking_not_finished',
]);

export const ACTIVE_HISTORY_EXCLUDED_STATUSES = new Set([
  'Completed',
  'flagged',
  'Cancelled',
  'Rescheduled',
  'pending_verification',
  'pending_review',
  'pending_payment',
  'cancellation_pending',
  'booking_not_finished',
]);

export function isActiveBookingForHistory(booking) {
  if (booking.pending_address_verification) return false;
  return !ACTIVE_HISTORY_EXCLUDED_STATUSES.has(booking.status);
}
