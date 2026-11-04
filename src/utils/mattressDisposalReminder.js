/**
 * Curbside mattress disposal reminders for delivery bookings only.
 * Illegal to mix mattresses with regular debris — must be sorted separately.
 */

export const MATTRESS_CURBSIDE_RECEIPT_NOTE =
  '(Mattress reminder: Do not put mattresses or box springs in the dumpster. They must be separated and placed at the curbside only for curb pickup. We do not pick up from the porch, driveway, or inside the house.)';

export const MATTRESS_CURBSIDE_EMAIL_NOTE =
  '(Mattress reminder: Do not put mattresses or box springs in the dumpster. They must be separated and placed at the curbside only for curb pickup. We do not pick up from the porch, driveway, or inside the house.)';

export const MATTRESS_CURBSIDE_SMS_NOTE =
  'Do not put the mattress in the dumpster — keep it separated at the curbside so we can throw it in the truck. Curb only; not porch, driveway, or inside.';

export function bookingHasMattressDisposal(source) {
  const addons = source?.addons && typeof source.addons === 'object' ? source.addons : source;
  return Number(addons?.mattressDisposal || 0) > 0;
}

/**
 * @param {object} booking
 * @param {(b: object) => boolean} isDeliveryFn
 */
export function shouldShowMattressCurbsideReminder(booking, isDeliveryFn) {
  if (!booking || typeof isDeliveryFn !== 'function') return false;
  return bookingHasMattressDisposal(booking) && Boolean(isDeliveryFn(booking));
}
