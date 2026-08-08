import {
  BUSINESS_TIME_ZONE,
  businessWallTimeToUtc,
  parseBookingTimeSlot,
  parseClockTime,
} from '@/utils/parseBookingTimeSlot';

export const PIN_LEAD_TIME_MS = 12 * 60 * 60 * 1000;

/**
 * Fallbacks for bookings with no usable time, in business-local hours. The previous version used
 * UTC fallbacks, and its 05:00 UTC end resolved to 11pm local on the day *before* pickup, which
 * made those bookings look finished before they started.
 */
const DEFAULT_START_LOCAL = { hour: 6, minute: 0, second: 0 };
const DEFAULT_END_LOCAL = { hour: 23, minute: 0, second: 0 };

/**
 * Resolve a booking-local wall time, preferring the typed column over the legacy text slot.
 * @param {string|null|undefined} typedValue
 * @param {string|null|undefined} textSlot
 * @param {'start'|'end'} edge
 * @param {object} fallback
 */
function resolveLocalTime(typedValue, textSlot, edge, fallback) {
  const typed = parseClockTime(typedValue);
  if (typed) return typed;

  const parsed = parseBookingTimeSlot(textSlot, 0);
  if (parsed) return edge === 'start' ? parsed.start : parsed.end;

  return fallback;
}

export function buildBookingDateUTC(date, timeSlot, fallbackLocalHour) {
  const parsed = parseBookingTimeSlot(timeSlot, 0);
  const local = parsed?.start ?? { hour: fallbackLocalHour, minute: 0, second: 0 };
  const instant = businessWallTimeToUtc(date, local, BUSINESS_TIME_ZONE);
  if (!instant) {
    return `${date}T${String(fallbackLocalHour).padStart(2, '0')}:00:00+00:00`;
  }
  return instant.toISOString();
}

export function getBookingWindow(booking) {
  const startLocal = resolveLocalTime(
    booking?.drop_off_window_start,
    booking?.drop_off_time_slot,
    'start',
    DEFAULT_START_LOCAL,
  );
  // A booking is live until the end of its pickup window, not the start of it.
  const endLocal = resolveLocalTime(
    booking?.pickup_window_end ?? booking?.pickup_window_start,
    booking?.pickup_time_slot,
    'end',
    DEFAULT_END_LOCAL,
  );

  const startDate = businessWallTimeToUtc(booking?.drop_off_date ?? '', startLocal);
  const endDate = businessWallTimeToUtc(booking?.pickup_date ?? '', endLocal);

  const startMs = startDate ? startDate.getTime() : NaN;
  const endMs = endDate ? endDate.getTime() : NaN;

  return {
    startMs,
    endMs,
    pinEligibleFromMs: startMs - PIN_LEAD_TIME_MS,
    startIso: startDate ? startDate.toISOString() : '',
    endIso: endDate ? endDate.toISOString() : '',
  };
}

export function isWithinPinGenerationWindow(booking, now = new Date()) {
  if (!booking?.drop_off_date || !booking?.pickup_date) return false;
  const { pinEligibleFromMs, endMs } = getBookingWindow(booking);
  if (!Number.isFinite(pinEligibleFromMs) || !Number.isFinite(endMs)) return false;
  const nowMs = now.getTime();
  return nowMs >= pinEligibleFromMs && nowMs < endMs;
}

export function isBookingEnded(booking, now = new Date()) {
  if (!booking?.pickup_date) return false;
  const { endMs } = getBookingWindow(booking);
  if (!Number.isFinite(endMs)) return false;
  return now.getTime() >= endMs;
}

/** The columns getBookingWindow needs, for callers building booking selects. */
export const BOOKING_WINDOW_COLUMNS =
  'drop_off_date, pickup_date, drop_off_time_slot, pickup_time_slot, ' +
  'drop_off_window_start, drop_off_window_end, pickup_window_start, pickup_window_end';
