import { supabase } from '@/lib/customSupabaseClient';
import { format, parse } from 'date-fns';

/**
 * Fetches service availability times from the database for a given service and date.
 * Matches BookingForm: date_specific_availability first, then partial fill from service_availability.
 * @param {number} serviceId - The service ID (e.g., 2 for Dump Loader Trailer)
 * @param {Date|string} date - The date to check availability for
 * @returns {Object} Object containing pickup_start_time and return_by_time
 */
export async function getServiceAvailabilityTimes(serviceId, date) {
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const dayOfWeek = dateObj.getDay();
    const dateStr = format(dateObj, 'yyyy-MM-dd');

    let pickupStartTime = null;
    let returnByTime = null;

    const { data: dateSpecific, error: dateError } = await supabase
      .from('date_specific_availability')
      .select('pickup_start_time, return_by_time')
      .eq('service_id', serviceId)
      .eq('date', dateStr)
      .maybeSingle();

    if (dateError) {
      console.warn('[ServiceAvailability] Error fetching date-specific times:', dateError);
    }

    if (dateSpecific?.pickup_start_time) pickupStartTime = dateSpecific.pickup_start_time;
    if (dateSpecific?.return_by_time) returnByTime = dateSpecific.return_by_time;

    if (!pickupStartTime || !returnByTime) {
      const { data: weeklyAvailability, error: weeklyError } = await supabase
        .from('service_availability')
        .select('pickup_start_time, return_by_time')
        .eq('service_id', serviceId)
        .eq('day_of_week', dayOfWeek)
        .maybeSingle();

      if (weeklyError) {
        console.warn('[ServiceAvailability] Error fetching weekly times:', weeklyError);
      } else if (weeklyAvailability) {
        if (!pickupStartTime && weeklyAvailability.pickup_start_time) {
          pickupStartTime = weeklyAvailability.pickup_start_time;
        }
        if (!returnByTime && weeklyAvailability.return_by_time) {
          returnByTime = weeklyAvailability.return_by_time;
        }
      }
    }

    return { pickupStartTime, returnByTime };
  } catch (error) {
    console.error('[ServiceAvailability] Error in getServiceAvailabilityTimes:', error);
    return {
      pickupStartTime: null,
      returnByTime: null
    };
  }
}

/**
 * Formats a time string (HH:MM:SS) to 12-hour format with AM/PM
 * @param {string} timeString - Time in HH:MM:SS format
 * @returns {string} Formatted time (e.g., "6:00 AM")
 */
export function formatTimeString(timeString) {
  if (!timeString) return 'Time not specified';

  try {
    const parsed = parse(timeString, 'HH:mm:ss', new Date());
    return format(parsed, 'h:mm a');
  } catch (error) {
    try {
      const parsed = parse(timeString, 'HH:mm', new Date());
      return format(parsed, 'h:mm a');
    } catch (innerError) {
      console.error('[ServiceAvailability] Error formatting time:', timeString, innerError);
      return 'Time not specified';
    }
  }
}

/**
 * Gets formatted availability times for display in UI
 * @param {number} serviceId - The service ID
 * @param {Date|string} date - The date to check
 * @returns {Object} Object with formatted pickupStartTime and returnByTime strings
 */
export async function getFormattedServiceTimes(serviceId, date) {
  const times = await getServiceAvailabilityTimes(serviceId, date);

  return {
    pickupStartTime: formatTimeString(times.pickupStartTime),
    returnByTime: formatTimeString(times.returnByTime)
  };
}
