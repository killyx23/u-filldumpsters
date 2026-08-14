import {
  BUSINESS_TIME_ZONE,
  businessWallTimeToUtc,
  parseBookingTimeSlot,
  parseClockTime,
} from '@/utils/parseBookingTimeSlot';

export const PIN_LEAD_TIME_MS = 12 * 60 * 60 * 1000;
/** Extra hour the padlock PIN stays valid after the scheduled booking end. */
export const RETURN_GRACE_MS = 60 * 60 * 1000;
/** Activate the PIN this many ms before drop-off so it works the instant they arrive. */
export const PIN_EARLY_ACTIVATION_MS = 5 * 60 * 1000;

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

/** Add RETURN_GRACE_MS to an ISO date string and return a new ISO (+00:00) string. */
export function addGraceHour(isoDate) {
  const ms = new Date(isoDate).getTime() + RETURN_GRACE_MS;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export function getBookingWindow(booking) {
  const startLocal = resolveLocalTime(
    booking?.drop_off_window_start,
    booking?.drop_off_time_slot,
    'start',
    DEFAULT_START_LOCAL,
  );
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
  const graceEndMs = endMs + RETURN_GRACE_MS;
  const graceEndIso = Number.isFinite(graceEndMs)
    ? new Date(graceEndMs).toISOString().replace(/\.\d{3}Z$/, '+00:00')
    : '';
  const activationMs = startMs - PIN_EARLY_ACTIVATION_MS;
  const activationIso = Number.isFinite(activationMs)
    ? new Date(activationMs).toISOString().replace(/\.\d{3}Z$/, '+00:00')
    : '';

  return {
    startMs,
    endMs,
    graceEndMs,
    pinEligibleFromMs: startMs - PIN_LEAD_TIME_MS,
    activationMs,
    activationIso,
    startIso: startDate ? startDate.toISOString() : '',
    endIso: endDate ? endDate.toISOString() : '',
    graceEndIso,
  };
}

/** Scheduled return time with no grace — for all customer-facing copy. */
export function getCustomerVisibleEndIso(booking) {
  return getBookingWindow(booking).endIso;
}

export function isWithinPinGenerationWindow(booking, now = new Date()) {
  if (!booking?.drop_off_date || !booking?.pickup_date) return false;
  const { pinEligibleFromMs, graceEndMs } = getBookingWindow(booking);
  if (!Number.isFinite(pinEligibleFromMs) || !Number.isFinite(graceEndMs)) return false;
  const nowMs = now.getTime();
  return nowMs >= pinEligibleFromMs && nowMs < graceEndMs;
}

export function isBookingEnded(booking, now = new Date()) {
  if (!booking?.pickup_date) return false;
  const { graceEndMs } = getBookingWindow(booking);
  if (!Number.isFinite(graceEndMs)) return false;
  return now.getTime() >= graceEndMs;
}

/** The columns getBookingWindow needs, for callers building booking selects. */
export const BOOKING_WINDOW_COLUMNS =
  'drop_off_date, pickup_date, drop_off_time_slot, pickup_time_slot, ' +
  'drop_off_window_start, drop_off_window_end, pickup_window_start, pickup_window_end';
