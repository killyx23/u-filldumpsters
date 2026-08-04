import { differenceInHours, isValid } from 'date-fns';
import { getPickupWindowTimes } from '@/utils/bookingPickupWindow';

/** License / insurance docs must be submitted at least this many hours before pickup. */
export const VERIFICATION_LEAD_HOURS = 12;

/**
 * Whether a booking still needs first-time driver/vehicle verification from a skip.
 * @param {object} booking
 * @param {object} [customer]
 * @returns {boolean}
 */
export function bookingNeedsSkippedVerification(booking, customer = null) {
  if (!booking) return false;
  if (booking.status === 'Cancelled' || booking.status === 'cancelled') return false;
  if (booking.status === 'Confirmed' || booking.status === 'confirmed') {
    // Confirmed after attestation / admin approve — no longer pending
    if (!booking.was_verification_skipped && !booking.addons?.wasVerificationSkipped) {
      return false;
    }
    // If still marked incomplete on customer, treat as needing docs
    if (customer?.has_incomplete_verification) return true;
    return false;
  }
  if (booking.status === 'pending_verification') return true;
  if (booking.was_verification_skipped || booking.addons?.wasVerificationSkipped) return true;
  if (customer?.has_incomplete_verification) return true;
  return false;
}

/**
 * Compute the 12-hour-before-pickup verification deadline for a booking.
 * @param {object} booking
 * @param {Date} [now]
 * @returns {{
 *   appointmentAt: Date|null,
 *   deadlineAt: Date|null,
 *   hoursRemaining: number|null,
 *   isPastDeadline: boolean,
 * }}
 */
export function getVerificationDeadlineInfo(booking, now = new Date()) {
  const empty = {
    appointmentAt: null,
    deadlineAt: null,
    hoursRemaining: null,
    isPastDeadline: false,
  };
  if (!booking?.drop_off_date) return empty;

  const { pickupStart } = getPickupWindowTimes(booking);
  const appointmentAt = pickupStart && isValid(pickupStart) ? pickupStart : null;
  if (!appointmentAt) return empty;

  const deadlineAt = new Date(appointmentAt.getTime() - VERIFICATION_LEAD_HOURS * 60 * 60 * 1000);
  const hoursRemainingRaw = differenceInHours(deadlineAt, now);
  const hoursRemaining = Math.max(0, hoursRemainingRaw);
  const isPastDeadline = now.getTime() >= deadlineAt.getTime();

  return {
    appointmentAt,
    deadlineAt,
    hoursRemaining: isPastDeadline ? 0 : hoursRemaining,
    isPastDeadline,
  };
}

/**
 * Human-readable countdown for portal Attention Required.
 * @param {object} booking
 * @param {Date} [now]
 * @returns {string|null}
 */
export function formatVerificationDeadlineMessage(booking, now = new Date()) {
  const { hoursRemaining, isPastDeadline, deadlineAt } = getVerificationDeadlineInfo(booking, now);
  if (!deadlineAt) return null;

  if (isPastDeadline) {
    return 'License verification overdue — your booking is under review and may be cancelled if documents are not completed.';
  }

  const hoursLabel = hoursRemaining === 1 ? '1 hour' : `${hoursRemaining} hours`;
  return `License verification due in ${hoursLabel} (required at least ${VERIFICATION_LEAD_HOURS} hours before pickup). Add your license plate, driver’s license (front and back), and insurance in Verification.`;
}
