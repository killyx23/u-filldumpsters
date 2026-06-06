export const PIN_LEAD_TIME_MS = 12 * 60 * 60 * 1000;

/**
 * Parse a time slot like "6:00 AM" and convert MST -> UTC.
 * MST is UTC-6, so we add 6 hours. Falls back to fallbackHourUTC if unparseable.
 */
export function buildBookingDateUTC(date, timeSlot, fallbackHourUTC) {
  const pad = (n) => String(n).padStart(2, '0');

  if (timeSlot) {
    const match = timeSlot.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match) {
      let hour = parseInt(match[1], 10);
      const minute = parseInt(match[2], 10);
      const meridiem = match[3].toUpperCase();
      if (meridiem === 'PM' && hour !== 12) hour += 12;
      if (meridiem === 'AM' && hour === 12) hour = 0;
      const utcHour = hour + 6;
      if (utcHour >= 24) {
        const nextDay = new Date(`${date}T00:00:00Z`);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        const nextDayStr = nextDay.toISOString().split('T')[0];
        return `${nextDayStr}T${pad(utcHour - 24)}:${pad(minute)}:00+00:00`;
      }
      return `${date}T${pad(utcHour)}:${pad(minute)}:00+00:00`;
    }
  }

  return `${date}T${pad(fallbackHourUTC)}:00:00+00:00`;
}

export function getBookingWindow(booking) {
  const startIso = buildBookingDateUTC(
    booking.drop_off_date ?? '',
    booking.drop_off_time_slot,
    12,
  );
  const endIso = buildBookingDateUTC(
    booking.pickup_date ?? '',
    booking.pickup_time_slot,
    5,
  );

  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();

  return {
    startMs,
    endMs,
    pinEligibleFromMs: startMs - PIN_LEAD_TIME_MS,
    startIso,
    endIso,
  };
}

export function isWithinPinGenerationWindow(booking, now = new Date()) {
  if (!booking?.drop_off_date || !booking?.pickup_date) return false;
  const { pinEligibleFromMs, endMs } = getBookingWindow(booking);
  const nowMs = now.getTime();
  return nowMs >= pinEligibleFromMs && nowMs < endMs;
}

export function isBookingEnded(booking, now = new Date()) {
  if (!booking?.pickup_date) return false;
  const { endMs } = getBookingWindow(booking);
  return now.getTime() >= endMs;
}
