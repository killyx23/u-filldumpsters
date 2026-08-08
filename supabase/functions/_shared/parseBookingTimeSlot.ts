/**
 * Booking time slot parsing, mirroring the SQL functions of the same name.
 *
 * Stored slots come in four shapes depending on which code path wrote the row: '6:00 AM',
 * '06:00:00', '06:00:00|08:00:00' and '08:00|17:00'. Anything that reasons about booking times
 * has to handle all four, and previously each caller handled a different subset.
 *
 * Prefer the typed bookings.*_window_start / *_window_end columns where they are available;
 * these helpers exist for rows written before those columns existed and for callers that only
 * have the text value to hand.
 *
 * Keep in sync with public.parse_clock_time and public.parse_booking_time_slot.
 */

export const BUSINESS_TIME_ZONE = "America/Denver";

export type ClockTime = { hour: number; minute: number; second: number };
export type TimeWindow = { start: ClockTime; end: ClockTime };

const TWELVE_HOUR = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i;
const TWENTY_FOUR_HOUR = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** Parses HH:mm, HH:mm:ss or h:mm AM/PM. Returns null for anything unrecognised. */
export function parseClockTime(value: string | null | undefined): ClockTime | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const twelve = TWELVE_HOUR.exec(raw);
  if (twelve) {
    let hour = parseInt(twelve[1], 10) % 12;
    if (twelve[4].toUpperCase() === "PM") hour += 12;
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

function toMinutes(t: ClockTime): number {
  return t.hour * 60 + t.minute;
}

/**
 * Normalises any stored slot into a start/end window.
 *
 * @param spanMinutes How long a single-valued slot lasts. Pass 0 for services whose slot is an
 *   instant rather than a window (hourly self-pickup stores a collection time and a return-by
 *   deadline, not a window).
 */
export function parseBookingTimeSlot(
  slot: string | null | undefined,
  spanMinutes = 120,
): TimeWindow | null {
  if (typeof slot !== "string") return null;
  const raw = slot.trim();
  if (!raw) return null;

  if (raw.includes("|")) {
    const [leftRaw, rightRaw] = raw.split("|");
    const start = parseClockTime(leftRaw);
    const end = parseClockTime(rightRaw);
    if (!start || !end) return null;
    return { start, end };
  }

  const start = parseClockTime(raw);
  if (!start) return null;

  const span = Math.max(spanMinutes ?? 0, 0);
  if (span === 0) return { start, end: { ...start } };

  const endMinutes = toMinutes(start) + span;
  // A late slot plus its span can run past midnight, which would leave end before start and
  // break every overlap test. Clamp to the end of the day instead.
  if (endMinutes >= 24 * 60) {
    return { start, end: { hour: 23, minute: 59, second: 59 } };
  }
  return {
    start,
    end: { hour: Math.floor(endMinutes / 60), minute: endMinutes % 60, second: 0 },
  };
}

/** Minutes the given zone is offset from UTC at a particular instant (negative west of UTC). */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const field = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Intl renders midnight as hour 24 in some runtimes; normalise it.
  const hour = field("hour") % 24;

  const asIfUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    hour,
    field("minute"),
    field("second"),
  );
  return (asIfUtc - instant.getTime()) / 60000;
}

/**
 * Converts a wall-clock date and time in the business timezone into a real UTC instant.
 *
 * The offset depends on the instant we are trying to find, so this resolves it in two passes:
 * guess using the offset at the naive instant, then re-check the offset at that result. That
 * matters because America/Denver is UTC-7 in winter and UTC-6 in summer, and the previous
 * implementation hardcoded a single offset.
 */
export function businessWallTimeToUtc(
  dateIso: string,
  time: ClockTime,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso ?? "");
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

/** Formats a ClockTime as HH:mm:ss, matching the Postgres `time` text representation. */
export function formatClockTime(time: ClockTime): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`;
}
