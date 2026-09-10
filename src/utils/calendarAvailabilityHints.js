import { addDays, eachDayOfInterval, endOfMonth, format, isBefore, startOfDay, startOfMonth } from 'date-fns';

/**
 * True when every future bookable day in the month is unavailable (read-only check).
 */
export function isMonthFullyUnavailable(month, availabilityMap, { loading = false } = {}) {
  if (loading || !month) return false;

  const minBookable = startOfDay(addDays(new Date(), 1));
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);

  let bookableCount = 0;

  for (let d = monthStart; !isBefore(monthEnd, d); d = addDays(d, 1)) {
    if (isBefore(d, minBookable)) continue;

    bookableCount++;
    const dateStr = format(d, 'yyyy-MM-dd');

    if (!(dateStr in availabilityMap)) return false;
    if (availabilityMap[dateStr]?.available === true) return false;
  }

  return bookableCount > 0;
}

/**
 * Whether a stay can occupy this calendar day overnight.
 *
 * Prefer `inventoryAvailable` from get-availability so a yard-closed Sunday does not
 * block Sat–Mon. Legacy payloads without that flag fall back to `available`.
 * Missing days (month not loaded yet) are treated as free so we do not over-block.
 */
export function isDateInventoryAvailable(dayAvail) {
  if (!dayAvail) return true;
  if (typeof dayAvail.inventoryAvailable === 'boolean') {
    return dayAvail.inventoryAvailable;
  }
  return dayAvail.available !== false;
}

export function isDateVisitUnavailable(dayAvail) {
  return dayAvail?.available === false;
}

/**
 * True when any day in the inclusive stay has no inventory left.
 */
export function rangeHasBlockedOccupancyNight(from, to, availability = {}) {
  if (!from || !to) return false;
  const start = startOfDay(from);
  const end = startOfDay(to);
  if (isBefore(end, start)) return false;
  return eachDayOfInterval({ start, end }).some((day) => {
    const key = format(day, 'yyyy-MM-dd');
    return !isDateInventoryAvailable(availability[key]);
  });
}

/**
 * True when any day in the inclusive stay is marked unavailable (hours or inventory).
 */
export function rangeHasUnavailableDay(from, to, availability = {}) {
  if (!from || !to) return false;
  const start = startOfDay(from);
  const end = startOfDay(to);
  if (isBefore(end, start)) return false;
  return eachDayOfInterval({ start, end }).some((day) => {
    const key = format(day, 'yyyy-MM-dd');
    return isDateVisitUnavailable(availability[key]);
  });
}

/**
 * After drop-off is known, whether this pickup date would occupy a full night.
 * Same-day (pickup === drop-off) is only blocked if that one day itself has no inventory.
 */
export function isPickupDateBlockedByRange(dropOff, candidatePickup, availability = {}) {
  if (!dropOff || !candidatePickup) return false;
  const start = startOfDay(dropOff);
  const end = startOfDay(candidatePickup);
  if (isBefore(end, start)) return false;
  return rangeHasBlockedOccupancyNight(start, end, availability);
}
