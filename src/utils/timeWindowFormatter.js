/**
 * Time Window Formatter Utility
 * Standardizes time window formatting across the entire website
 */

import { format, parseISO, isValid, addHours } from 'date-fns';

/**
 * Format time window for display
 * @param {string} timeString - Time string (HH:mm format)
 * @param {object} options - Formatting options
 * @param {boolean} options.isWindow - Whether to show as a 2-hour window
 * @param {boolean} options.isSelfService - Whether this is self-service (trailer)
 * @param {string} options.serviceType - Service type (window, hourly, etc.)
 * @returns {string} Formatted time window
 */
export function formatTimeWindow(timeString, options = {}) {
  const { isWindow = false, isSelfService = false, serviceType = '' } = options;
  
  if (!timeString || !/^\d{2}:\d{2}/.test(timeString)) {
    return 'Time not specified';
  }

  try {
    const [hours, minutes] = timeString.split(':');
    const date = new Date();
    date.setHours(parseInt(hours, 10));
    date.setMinutes(parseInt(minutes || '0', 10));

    if (!isValid(date)) {
      return timeString;
    }

    // Self-service trailer: show "after 8:00 AM" or "by 10:00 PM"
    if (isSelfService) {
      if (timeString.startsWith('08:00')) {
        return `after ${format(date, 'h:mm a')}`;
      }
      if (timeString.startsWith('22:00') || timeString.startsWith('10:00')) {
        return `by ${format(date, 'h:mm a')}`;
      }
    }

    // Window service or isWindow flag: show 2-hour window
    if (isWindow || serviceType === 'window' || serviceType === 'material_delivery') {
      const endTime = addHours(date, 2);
      return `${format(date, 'h:mm a')} - ${format(endTime, 'h:mm a')}`;
    }

    // Default: show single time with AM/PM
    return format(date, 'h:mm a');
  } catch (e) {
    console.error('[timeWindowFormatter] Error formatting time:', e);
    return typeof timeString === 'string' ? timeString : 'Time not specified';
  }
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
  
  // Delivery services and window-based services show time windows
  return isDelivery || 
         plan.service_type === 'window' || 
         plan.service_type === 'material_delivery' ||
         plan.id === 1 || // Dumpster Rental (always delivery)
         plan.id === 4;   // Dump Loader with Delivery
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