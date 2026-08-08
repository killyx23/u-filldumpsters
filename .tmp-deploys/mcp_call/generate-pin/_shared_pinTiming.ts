export const PIN_LEAD_TIME_MS = 12 * 60 * 60 * 1000;
/** Extra hour the padlock PIN stays valid after the scheduled booking end. */
export const RETURN_GRACE_MS = 60 * 60 * 1000;

export type BookingWindowFields = {
  drop_off_date?: string | null;
  drop_off_time_slot?: string | null;
  pickup_date?: string | null;
  pickup_time_slot?: string | null;
};

/**
 * Parse a time slot like "6:00 AM" and convert MST -> UTC.
 * MST is UTC-6, so we add 6 hours. Falls back to fallbackHourUTC if unparseable.
 */
export function buildBookingDateUTC(
  date: string,
  timeSlot: string | null | undefined,
  fallbackHourUTC: number,
): string {
  const pad = (n: number) => String(n).padStart(2, "0");

  if (timeSlot) {
    const match = timeSlot.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match) {
      let hour = parseInt(match[1], 10);
      const minute = parseInt(match[2], 10);
      const meridiem = match[3].toUpperCase();
      if (meridiem === "PM" && hour !== 12) hour += 12;
      if (meridiem === "AM" && hour === 12) hour = 0;
      const utcHour = hour + 6;
      if (utcHour >= 24) {
        const nextDay = new Date(date + "T00:00:00Z");
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        const nextDayStr = nextDay.toISOString().split("T")[0];
        return `${nextDayStr}T${pad(utcHour - 24)}:${pad(minute)}:00+00:00`;
      }
      return `${date}T${pad(utcHour)}:${pad(minute)}:00+00:00`;
    }
  }

  return `${date}T${pad(fallbackHourUTC)}:00:00+00:00`;
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
  const startIso = buildBookingDateUTC(
    booking.drop_off_date ?? "",
    booking.drop_off_time_slot,
    12,
  );
  const endIso = buildBookingDateUTC(
    booking.pickup_date ?? "",
    booking.pickup_time_slot,
    5,
  );

  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const graceEndMs = endMs + RETURN_GRACE_MS;
  const graceEndIso = new Date(graceEndMs).toISOString().replace(/\.\d{3}Z$/, "+00:00");

  return {
    startMs,
    endMs,
    graceEndMs,
    pinEligibleFromMs: startMs - PIN_LEAD_TIME_MS,
    startIso,
    endIso,
    graceEndIso,
  };
}

export function isWithinPinGenerationWindow(
  booking: BookingWindowFields,
  now: Date = new Date(),
): boolean {
  if (!booking.drop_off_date || !booking.pickup_date) return false;
  const { pinEligibleFromMs, graceEndMs } = getBookingWindow(booking);
  const nowMs = now.getTime();
  return nowMs >= pinEligibleFromMs && nowMs < graceEndMs;
}

export function isBookingEnded(
  booking: BookingWindowFields,
  now: Date = new Date(),
): boolean {
  if (!booking.pickup_date) return false;
  const { graceEndMs } = getBookingWindow(booking);
  return now.getTime() >= graceEndMs;
}

export function getPinWindowSkipReason(
  booking: BookingWindowFields,
  now: Date = new Date(),
): "too_early" | "ended" | null {
  if (!booking.drop_off_date || !booking.pickup_date) return "too_early";
  const { pinEligibleFromMs, graceEndMs } = getBookingWindow(booking);
  const nowMs = now.getTime();
  if (nowMs < pinEligibleFromMs) return "too_early";
  if (nowMs >= graceEndMs) return "ended";
  return null;
}
