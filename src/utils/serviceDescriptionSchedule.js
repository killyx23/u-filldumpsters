import { AVAILABILITY_UI, getServiceAvailabilityUiKind } from '@/utils/availabilityServiceUi';

/** Matches legacy baked-in schedule copy in services.description (any AM/PM times). */
export const LEGACY_SCHEDULE_PATTERN =
  /Pick up starts for our same-day rental at .+?, but it must be returned by .+? that day\.\s*/i;

export const NO_DATE_SCHEDULE_MESSAGE =
  'Select a pickup date to view exact same-day rental hours.';

export const NO_TIMES_SCHEDULE_MESSAGE =
  'Same-day rental hours follow your selected date and our availability schedule.';

export function stripLegacyScheduleSentence(description) {
  if (!description) return '';
  return description.replace(LEGACY_SCHEDULE_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
}

export function buildScheduleSentence(pickupStart, returnBy) {
  return `Pick up starts for our same-day rental at ${pickupStart}, but it must be returned by ${returnBy} that day.`;
}

function insertScheduleAfterRentals(text, sentence) {
  const patterns = [
    /(same-day or multiple-day rentals\.)/i,
    /(same-day or multi-day rentals available\.)/i,
    /(multiple-day rentals\.)/i,
    /(rentals\.)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const insertAt = text.indexOf(match[0]) + match[0].length;
      return `${text.slice(0, insertAt)} ${sentence}${text.slice(insertAt)}`;
    }
  }

  return `${text} ${sentence}`.trim();
}

function hasValidFormattedTimes(times) {
  if (!times) return false;
  const { pickupStartTime, returnByTime } = times;
  return (
    pickupStartTime &&
    returnByTime &&
    pickupStartTime !== 'Time not specified' &&
    returnByTime !== 'Time not specified'
  );
}

/**
 * Strips legacy hardcoded hours from description and injects live schedule copy for hourly pickup services.
 * @param {string} description
 * @param {{ pickupStartTime?: string, returnByTime?: string }|null} times
 * @param {number} serviceId
 * @param {boolean} hasReferenceDate
 */
export function applyDynamicScheduleToDescription(description, times, serviceId, hasReferenceDate) {
  if (getServiceAvailabilityUiKind(serviceId) !== AVAILABILITY_UI.HOURLY_PICKUP) {
    return description || '';
  }

  const baseText = stripLegacyScheduleSentence(description);

  if (!hasReferenceDate) {
    return insertScheduleAfterRentals(baseText, NO_DATE_SCHEDULE_MESSAGE);
  }

  if (hasValidFormattedTimes(times)) {
    return insertScheduleAfterRentals(
      baseText,
      buildScheduleSentence(times.pickupStartTime, times.returnByTime)
    );
  }

  return insertScheduleAfterRentals(baseText, NO_TIMES_SCHEDULE_MESSAGE);
}
