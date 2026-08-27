/**
 * Time Window Formatter Utility
 * Standardizes time window formatting across the entire website
 */

import { format, parseISO, isValid, addHours, parse } from 'date-fns';

/**
 * Parse booking time slots stored as 24h (HH:mm / HH:mm:ss) or 12h (h:mm a).
 * @param {string} timeString
 * @returns {Date|null}
 */
export function parseBookingTimeToDate(timeString) {
  if (!timeString || typeof timeString !== 'string') return null;
  const trimmed = timeString.trim();
  if (!trimmed) return null;

  const ref = new Date(2000, 0, 1);

  try {
    const parsed24Sec = parse(trimmed, 'HH:mm:ss', ref);
    if (isValid(parsed24Sec)) return parsed24Sec;
  } catch (_) { /* continue */ }

  try {
    const parsed24 = parse(trimmed, 'HH:mm', ref);
    if (isValid(parsed24) && !/\s*(AM|PM)/i.test(trimmed)) return parsed24;
  } catch (_) { /* continue */ }

  try {
    const parsed12 = parse(trimmed, 'h:mm a', ref);
    if (isValid(parsed12)) return parsed12;
  } catch (_) { /* continue */ }

  return null;
}

/**
 * Format time window for display
 * @param {string} timeString - Time string (24h HH:mm or 12h h:mm a)
 * @param {object} options - Formatting options
 * @param {boolean} options.isWindow - Whether to show as a 2-hour window
 * @param {boolean} options.isSelfService - Whether this is self-service (trailer)
 * @param {boolean} options.isReturnBy - For self-service return/pickup-by line
 * @param {string} options.serviceType - Service type (window, hourly, etc.)
 * @returns {string} Formatted time window
 */
export function formatTimeWindow(timeString, options = {}) {
  const { isWindow = false, isSelfService = false, isReturnBy = false, serviceType = '' } = options;

  if (!timeString) {
    return 'Time not specified';
  }

  // Explicit ranges from delivery pickup windows: "06:00:00|08:00:00"
  if (typeof timeString === 'string' && timeString.includes('|')) {
    const [startRaw, endRaw] = timeString.split('|').map((t) => t.trim()).filter(Boolean);
    const startDate = parseBookingTimeToDate(startRaw);
    const endDate = parseBookingTimeToDate(endRaw);
    if (startDate && isValid(startDate) && endDate && isValid(endDate)) {
      return `${format(startDate, 'h:mm a')} - ${format(endDate, 'h:mm a')}`;
    }
    if (startDate && isValid(startDate)) return format(startDate, 'h:mm a');
    if (endDate && isValid(endDate)) return format(endDate, 'h:mm a');
    return timeString;
  }

  const date = parseBookingTimeToDate(timeString);
  if (!date || !isValid(date)) {
    return typeof timeString === 'string' ? timeString : 'Time not specified';
  }

  try {
    if (isSelfService) {
      const hour24 = date.getHours();
      const minute = date.getMinutes();
      if (isReturnBy || hour24 >= 22 || (hour24 === 23 && minute === 0)) {
        return `by ${format(date, 'h:mm a')}`;
      }
      if (hour24 <= 8 || (hour24 === 6 && minute === 0)) {
        return `after ${format(date, 'h:mm a')}`;
      }
      return format(date, 'h:mm a');
    }

    if (isWindow || serviceType === 'window' || serviceType === 'material_delivery') {
      const endTime = addHours(date, 2);
      return `${format(date, 'h:mm a')} - ${format(endTime, 'h:mm a')}`;
    }

    return format(date, 'h:mm a');
  } catch (e) {
    console.error('[timeWindowFormatter] Error formatting time:', e);
    return typeof timeString === 'string' ? timeString : 'Time not specified';
  }
}

/**
 * Delivery arrival/pickup copy: "between 6:00 AM and 8:00 AM".
 * Uses an explicit pipe range when present, otherwise a 2-hour window from the start time.
 */
export function formatTimeWindowBetween(timeString, options = {}) {
  const formatted = formatTimeWindow(timeString, {
    ...options,
    isWindow: true,
    isSelfService: false,
    isReturnBy: false,
  });
  if (!formatted || formatted === 'Time not specified') return formatted;
  if (formatted.includes(' - ')) {
    const [start, end] = formatted.split(' - ');
    if (start && end) return `between ${start} and ${end}`;
  }
  return formatted;
}

/**
 * Format booking date and time window
 * @param {string|Date} date - Date string or Date object
 * @param {string} timeSlot - Time slot string
 * @param {object} options - Formatting options
 * @returns {string} Formatted date and time
 */
export function formatBookingDateTime(date, timeSlot, options = {}) {
  if (!date) return 'Date not specified';

  try {
    const parsedDate = date instanceof Date ? date : parseISO(date.toString());
    if (!isValid(parsedDate)) return "Invalid Date";

    const dateStr = format(parsedDate, 'MMM d, yyyy');
    const timeStr = timeSlot ? formatTimeWindow(timeSlot, options) : '';

    return timeStr ? `${dateStr} (${timeStr})` : dateStr;
  } catch (e) {
    console.error('[timeWindowFormatter] Error formatting date/time:', e);
    return "Invalid Date";
  }
}

/**
 * Determine if service should show time windows
 * @param {object} plan - Plan/service object
 * @param {boolean} isDelivery - Whether delivery service is selected
 * @returns {boolean} True if should show time windows
 */
export function shouldShowTimeWindow(plan, isDelivery = false) {
  if (!plan) return false;

  return isDelivery ||
         plan.service_type === 'window' ||
         plan.service_type === 'material_delivery' ||
         plan.id === 1 ||
         plan.id === 4;
}

/**
 * Determine if service is self-service trailer
 * @param {object} plan - Plan/service object
 * @param {boolean} isDelivery - Whether delivery service is selected
 * @returns {boolean} True if self-service trailer
 */
export function isSelfServiceTrailer(plan, isDelivery = false) {
  if (!plan) return false;
  return plan.service_type === 'hourly' && !isDelivery;
}
