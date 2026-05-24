import { parseISO, isValid, set, subHours, isAfter, isBefore } from 'date-fns';
import { parseBookingTimeToDate } from '@/utils/timeWindowFormatter';

/**
 * Combine booking date (YYYY-MM-DD) and time slot into a single Date.
 * @param {string} dateStr
 * @param {string} timeSlot
 * @returns {Date|null}
 */
export function getBookingDateTime(dateStr, timeSlot) {
  if (!dateStr) return null;
  let date;
  try {
    date = parseISO(dateStr);
  } catch {
    return null;
  }
  if (!isValid(date)) return null;

  const time = parseBookingTimeToDate(timeSlot);
  if (!time) return date;

  return set(date, {
    hours: time.getHours(),
    minutes: time.getMinutes(),
    seconds: 0,
    milliseconds: 0,
  });
}

/**
 * Pickup start = drop_off_* ; return by = pickup_* for customer pickup rentals.
 * @param {object} booking
 * @returns {{ pickupStart: Date|null, returnBy: Date|null }}
 */
export function getPickupWindowTimes(booking) {
  if (!booking) return { pickupStart: null, returnBy: null };
  return {
    pickupStart: getBookingDateTime(booking.drop_off_date, booking.drop_off_time_slot),
    returnBy: getBookingDateTime(booking.pickup_date, booking.pickup_time_slot),
  };
}

/**
 * @typedef {'pending' | 'revealed' | 'finished'} PickupLocationPhase
 */

/**
 * @param {object} booking
 * @param {Date} [now]
 * @returns {PickupLocationPhase}
 */
export function getPickupLocationPhase(booking, now = new Date()) {
  const { pickupStart, returnBy } = getPickupWindowTimes(booking);

  if (!pickupStart) return 'pending';

  if (returnBy && isAfter(now, returnBy)) {
    return 'finished';
  }

  const revealAt = subHours(pickupStart, 12);
  if (isBefore(now, revealAt)) {
    return 'pending';
  }

  return 'revealed';
}

/**
 * Show embedded directions map during the rental visibility window.
 * @param {object} booking
 * @param {Date} [now]
 * @returns {boolean}
 */
export function showDirectionsMap(booking, now = new Date()) {
  return getPickupLocationPhase(booking, now) === 'revealed';
}
