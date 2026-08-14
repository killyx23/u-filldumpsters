import {
  BUSINESS_TIME_ZONE,
  businessWallTimeToUtc,
  type ClockTime,
  parseBookingTimeSlot,
  parseClockTime,
} from "./parseBookingTimeSlot.ts";

export const PIN_LEAD_TIME_MS = 12 * 60 * 60 * 1000;
/** Extra hour the padlock PIN stays valid after the scheduled booking end. */
export const RETURN_GRACE_MS = 60 * 60 * 1000;
/** Activate the PIN this many ms before drop-off so it works the instant they arrive. */
export const PIN_EARLY_ACTIVATION_MS = 5 * 60 * 1000;

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

/** Add RETURN_GRACE_MS to an ISO date string and return a new ISO (+00:00) string. */
export function addGraceHour(isoDate: string): string {
  const ms = new Date(isoDate).getTime() + RETURN_GRACE_MS;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

/**
 * Igloohome rejects a duration PIN whose startDate falls before the current hour.
 * Raises a past start up to the top of the current hour; leaves future starts alone.
 */
export function clampIgloohomeStart(isoDate: string, now: Date = new Date()): string {
  const hourFloor = new Date(now.getTime());
  hourFloor.setUTCMinutes(0, 0, 0);
  const ms = Math.max(new Date(isoDate).getTime(), hourFloor.getTime());
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function getBookingWindow(booking: BookingWindowFields) {
  const startLocal = resolveLocalTime(
    booking.drop_off_window_start,
    booking.drop_off_time_slot,
    "start",
    DEFAULT_START_LOCAL,
  );
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
  const graceEndMs = endMs + RETURN_GRACE_MS;
  const graceEndIso = Number.isFinite(graceEndMs)
    ? new Date(graceEndMs).toISOString().replace(/\.\d{3}Z$/, "+00:00")
    : "";
  const activationMs = startMs - PIN_EARLY_ACTIVATION_MS;
  const activationIso = Number.isFinite(activationMs)
    ? new Date(activationMs).toISOString().replace(/\.\d{3}Z$/, "+00:00")
    : "";

  return {
    startMs,
    endMs,
    graceEndMs,
    pinEligibleFromMs: startMs - PIN_LEAD_TIME_MS,
    activationMs,
    activationIso,
    startIso: startDate ? startDate.toISOString() : "",
    endIso: endDate ? endDate.toISOString() : "",
    graceEndIso,
  };
}

/**
 * PIN start sent to Igloohome: booking drop-off minus 5 minutes, clamped to the
 * current hour so Igloohome accepts it. Customers still see the appointment time.
 */
export function getPinActivationStart(
  booking: BookingWindowFields,
  now: Date = new Date(),
): string {
  const { activationIso } = getBookingWindow(booking);
  return clampIgloohomeStart(activationIso, now);
}

/** Scheduled return time with no grace — for all customer-facing copy. */
export function getCustomerVisibleEndIso(booking: BookingWindowFields): string {
  return getBookingWindow(booking).endIso;
}

export function isWithinPinGenerationWindow(
  booking: BookingWindowFields,
  now: Date = new Date(),
): boolean {
  if (!booking.drop_off_date || !booking.pickup_date) return false;
  const { pinEligibleFromMs, graceEndMs } = getBookingWindow(booking);
  if (!Number.isFinite(pinEligibleFromMs) || !Number.isFinite(graceEndMs)) return false;
  const nowMs = now.getTime();
  return nowMs >= pinEligibleFromMs && nowMs < graceEndMs;
}

export function isBookingEnded(
  booking: BookingWindowFields,
  now: Date = new Date(),
): boolean {
  if (!booking.pickup_date) return false;
  const { graceEndMs } = getBookingWindow(booking);
  if (!Number.isFinite(graceEndMs)) return false;
  return now.getTime() >= graceEndMs;
}

export function getPinWindowSkipReason(
  booking: BookingWindowFields,
  now: Date = new Date(),
): "too_early" | "ended" | null {
  if (!booking.drop_off_date || !booking.pickup_date) return "too_early";
  const { pinEligibleFromMs, graceEndMs } = getBookingWindow(booking);
  if (!Number.isFinite(pinEligibleFromMs) || !Number.isFinite(graceEndMs)) return "too_early";
  const nowMs = now.getTime();
  if (nowMs < pinEligibleFromMs) return "too_early";
  if (nowMs >= graceEndMs) return "ended";
  return null;
}

/** The columns getBookingWindow needs, for edge functions building their booking selects. */
export const BOOKING_WINDOW_COLUMNS =
  "drop_off_date, pickup_date, drop_off_time_slot, pickup_time_slot, " +
  "drop_off_window_start, drop_off_window_end, pickup_window_start, pickup_window_end";
