import { addDays, endOfMonth, format, isBefore, startOfDay, startOfMonth } from 'date-fns';

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
