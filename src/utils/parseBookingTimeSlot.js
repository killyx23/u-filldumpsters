/**
 * Booking time slot parsing for the frontend.
 *
 * Mirror of supabase/functions/_shared/parseBookingTimeSlot.ts and of the SQL functions
 * public.parse_clock_time / public.parse_booking_time_slot. Stored slots come in four shapes
 * depending on which code path wrote the row ('6:00 AM', '06:00:00', '06:00:00|08:00:00',
 * '08:00|17:00'), and callers used to each handle a different subset.
 *
 * Prefer the typed bookings.*_window_start / *_window_end columns where available; these
 * helpers cover legacy rows and callers that only have the text value.
 */

export const BUSINESS_TIME_ZONE = 'America/Denver';

const TWELVE_HOUR = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i;
const TWENTY_FOUR_HOUR = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parses HH:mm, HH:mm:ss or h:mm AM/PM.
 * @param {string|null|undefined} value
 * @returns {{hour: number, minute: number, second: number}|null}
 */
export function parseClockTime(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  const twelve = TWELVE_HOUR.exec(raw);
  if (twelve) {
    let hour = parseInt(twelve[1], 10) % 12;
    if (twelve[4].toUpperCase() === 'PM') hour += 12;
    const minute = parseInt(twelve[2], 10);
    const second = twelve[3] ? parseInt(twelve[3], 10) : 0;
    if (minute > 59 || second > 59) return null;
    return { hour, minute, second };
  }

  const twentyFour = TWENTY_FOUR_HOUR.exec(raw);
  if (twentyFour) {
    const hour = parseInt(twentyFour[1], 10);
    const minute = parseInt(twentyFour[2], 10);
    const second = twentyFour[3] ? parseInt(twentyFour[3], 10) : 0;
    if (hour > 23 || minute > 59 || second > 59) return null;
    return { hour, minute, second };
  }

  return null;
}

/**
 * Normalises any stored slot into a start/end window.
 * @param {string|null|undefined} slot
 * @param {number} spanMinutes How long a single-valued slot lasts. Pass 0 when the slot is an
 *   instant rather than a window, as it is for hourly self-pickup services.
 * @returns {{start: object, end: object}|null}
 */
export function parseBookingTimeSlot(slot, spanMinutes = 120) {
  if (typeof slot !== 'string') return null;
  const raw = slot.trim();
  if (!raw) return null;

  if (raw.includes('|')) {
    const [leftRaw, rightRaw] = raw.split('|');
    const start = parseClockTime(leftRaw);
    const end = parseClockTime(rightRaw);
    if (!start || !end) return null;
    return { start, end };
  }

  const start = parseClockTime(raw);
  if (!start) return null;

  const span = Math.max(spanMinutes ?? 0, 0);
  if (span === 0) return { start, end: { ...start } };

  const endMinutes = start.hour * 60 + start.minute + span;
  // Clamp rather than wrap past midnight, which would leave end before start.
  if (endMinutes >= 24 * 60) {
    return { start, end: { hour: 23, minute: 59, second: 59 } };
  }
  return {
    start,
    end: { hour: Math.floor(endMinutes / 60), minute: endMinutes % 60, second: 0 },
  };
}

/** Minutes the given zone is offset from UTC at a particular instant (negative west of UTC). */
function zoneOffsetMinutes(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const field = (type) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const hour = field('hour') % 24;

  const asIfUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    hour,
    field('minute'),
    field('second'),
  );
  return (asIfUtc - instant.getTime()) / 60000;
}

/**
 * Converts a wall-clock date and time in the business timezone into a real UTC instant.
 *
 * Resolved in two passes because the offset depends on the instant being sought. America/Denver
 * is UTC-7 in winter and UTC-6 in summer; the previous implementation hardcoded one offset.
 *
 * @param {string} dateIso yyyy-MM-dd
 * @param {{hour: number, minute: number, second: number}} time
 * @returns {Date|null}
 */
export function businessWallTimeToUtc(dateIso, time, timeZone = BUSINESS_TIME_ZONE) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso ?? '');
  if (!dateMatch) return null;

  const naive = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    time.hour,
    time.minute,
    time.second,
  );

  const firstOffset = zoneOffsetMinutes(new Date(naive), timeZone);
  let resolved = new Date(naive - firstOffset * 60000);

  const secondOffset = zoneOffsetMinutes(resolved, timeZone);
  if (secondOffset !== firstOffset) {
    resolved = new Date(naive - secondOffset * 60000);
  }
  return resolved;
}
