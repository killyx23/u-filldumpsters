import { bookingIsCompanyDelivery } from '@/utils/bookingMileage';
import { mentionsDumpTrailer } from '@/utils/displayPlanName';

/**
 * Dump-trailer style rentals that can show an access-code section
 * (yard pickup gets a PIN; delivery gets an explanatory N/A state).
 */
export function isTrailerAccessCodeService(booking) {
  const plan = booking?.plan;
  if (!plan) return false;
  const planName = String(plan.name || '').toLowerCase();
  const planId = Number(plan.id);
  return (
    mentionsDumpTrailer(planName) ||
    planName.includes('trailer') ||
    planId === 2 ||
    planId === 4
  );
}

/** Yard self-pickup dump trailer — real padlock PIN flow. */
export function bookingNeedsYardAccessCode(booking) {
  return isTrailerAccessCodeService(booking) && !bookingIsCompanyDelivery(booking);
}

/** Trailer booking that is company delivery — access code does not apply. */
export function bookingAccessCodeNotApplicable(booking) {
  return isTrailerAccessCodeService(booking) && bookingIsCompanyDelivery(booking);
}

export const ACCESS_CODE_DELIVERY_TITLE = 'Not Applicable to Delivery';
export const ACCESS_CODE_DELIVERY_BODY =
  'Access codes are for yard pickup rentals only. This booking is a delivery service, so a padlock code is not used — we deliver and pick up the equipment for you.';
