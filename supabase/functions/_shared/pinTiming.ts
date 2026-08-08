import {
  BUSINESS_TIME_ZONE,
  businessWallTimeToUtc,
  type ClockTime,
  parseBookingTimeSlot,
  parseClockTime,
} from "./parseBookingTimeSlot.ts";

export const PIN_LEAD_TIME_MS = 12 * 60 * 60 * 1000;

/**
 * When a booking has no usable time at all, assume the yard's normal operating bounds. These
 * are business-local hours, not UTC: the previous implementation used UTC fallbacks, and the
 * end fallback of 05:00 UTC actually resolved to 11pm local on the day *before* pickup, which
 * made such bookings look finished before they began.
 */
const DEFAULT_START_LOCAL: ClockTime = { hour: 6, minute: 0, second: 0 };
const DEFAULT_END_LOCAL: ClockTime = { hour: 23, minute: 0, second: 0 };

export type BookingWindowFields = {
  drop_off_date?: string | null;
  drop_off_time_slot?: string | null;
  pickup_date?: string | null;
  pickup_time_slot?: string | null;
  /** Typed columns added in the time-window normalisation migration; preferred when present. */
  drop_off_window_start?: string | null;
  drop_off_window_end?: string | null;
  pickup_window_start?: string | null;
  pickup_window_end?: string | null;
};

/**
 * Resolve a booking-local wall time, preferring the typed column and falling back to parsing
 * the legacy text slot. `edge` picks which end of a window to use.
 */
function resolveLocalTime(
  typedValue: string | null | undefined,
  textSlot: string | null | undefined,
  edge: "start" | "end",
  fallback: ClockTime,
): ClockTime {
  const typed = parseClockTime(typedValue);
  if (typed) return typed;

  // No span is applied here: without the service we cannot know a slot's length, and for the
  // window end that would only ever shorten or lengthen it arbitrarily. The typed columns are
  // populated by trigger, so this path is for legacy rows only.
  const parsed = parseBookingTimeSlot(textSlot, 0);
  if (parsed) return edge === "start" ? parsed.start : parsed.end;

  return fallback;
}

export function buildBookingDateUTC(
  date: string,
  timeSlot: string | null | undefined,
  fallbackLocalHour: number,
): string {
  const parsed = parseBookingTimeSlot(timeSlot, 0);
  const local = parsed?.start ?? { hour: fallbackLocalHour, minute: 0, second: 0 };
  const instant = businessWallTimeToUtc(date, local, BUSINESS_TIME_ZONE);
  if (!instant) {
    return `${date}T${String(fallbackLocalHour).padStart(2, "0")}:00:00+00:00`;
  }
  return instant.toISOString();
}

export function getBookingWindow(booking: BookingWindowFields) {
  const startLocal = resolveLocalTime(
    booking.drop_off_window_start,
    booking.drop_off_time_slot,
    "start",
    DEFAULT_START_LOCAL,
  );
  // A booking is still live until the end of its pickup window, not the start of it.
  const endLocal = resolveLocalTime(
    booking.pickup_window_end ?? booking.pickup_window_start,
    booking.pickup_time_slot,
    "end",
    DEFAULT_END_LOCAL,
  );

  const startDate = businessWallTimeToUtc(booking.drop_off_date ?? "", startLocal);
  const endDate = businessWallTimeToUtc(booking.pickup_date ?? "", endLocal);

  const startMs = startDate ? startDate.getTime() : NaN;
  const endMs = endDate ? endDate.getTime() : NaN;

  return {
    startMs,
    endMs,
    pinEligibleFromMs: startMs - PIN_LEAD_TIME_MS,
    startIso: startDate ? startDate.toISOString() : "",
    endIso: endDate ? endDate.toISOString() : "",
  };
}

export function isWithinPinGenerationWindow(
  booking: BookingWindowFields,
  now: Date = new Date(),
): boolean {
  if (!booking.drop_off_date || !booking.pickup_date) return false;
  const { pinEligibleFromMs, endMs } = getBookingWindow(booking);
  if (!Number.isFinite(pinEligibleFromMs) || !Number.isFinite(endMs)) return false;
  const nowMs = now.getTime();
  return nowMs >= pinEligibleFromMs && nowMs < endMs;
}

export function isBookingEnded(
  booking: BookingWindowFields,
  now: Date = new Date(),
): boolean {
  if (!booking.pickup_date) return false;
  const { endMs } = getBookingWindow(booking);
  if (!Number.isFinite(endMs)) return false;
  return now.getTime() >= endMs;
}

export function getPinWindowSkipReason(
  booking: BookingWindowFields,
  now: Date = new Date(),
): "too_early" | "ended" | null {
  if (!booking.drop_off_date || !booking.pickup_date) return "too_early";
  const { pinEligibleFromMs, endMs } = getBookingWindow(booking);
  if (!Number.isFinite(pinEligibleFromMs) || !Number.isFinite(endMs)) return "too_early";
  const nowMs = now.getTime();
  if (nowMs < pinEligibleFromMs) return "too_early";
  if (nowMs >= endMs) return "ended";
  return null;
}

/** The columns getBookingWindow needs, for edge functions building their booking selects. */
export const BOOKING_WINDOW_COLUMNS =
  "drop_off_date, pickup_date, drop_off_time_slot, pickup_time_slot, " +
  "drop_off_window_start, drop_off_window_end, pickup_window_start, pickup_window_end";
