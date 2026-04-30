import { supabase } from '@/lib/customSupabaseClient';
import { format, parse } from 'date-fns';

/**
 * Fetches service availability times from the database for a given service and date
 * @param {number} serviceId - The service ID (e.g., 2 for Dump Loader Trailer)
 * @param {Date|string} date - The date to check availability for
 * @returns {Object} Object containing pickup_start_time and return_by_time
 */
export async function getServiceAvailabilityTimes(serviceId, date) {
  try {
    // Convert date to Date object if it's a string
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const dayOfWeek = dateObj.getDay(); // 0 = Sunday, 6 = Saturday

    // First, try to get date-specific availability
    const { data: dateSpecific, error: dateError } = await supabase
      .from('date_specific_availability')
      .select('pickup_start_time, return_by_time')
      .eq('service_id', serviceId)
      .eq('date', format(dateObj, 'yyyy-MM-dd'))
      .eq('is_available', true)
      .single();

    if (!dateError && dateSpecific) {
      return {
        pickupStartTime: dateSpecific.pickup_start_time,
        returnByTime: dateSpecific.return_by_time
      };
    }

    // Fall back to weekly service_availability
    const { data: weeklyAvailability, error: weeklyError } = await supabase
      .from('service_availability')
      .select('pickup_start_time, return_by_time')
      .eq('service_id', serviceId)
      .eq('day_of_week', dayOfWeek)
      .eq('is_available', true)
      .single();

    if (weeklyError) {
      console.error('[ServiceAvailability] Error fetching times:', weeklyError);
      return {
        pickupStartTime: null,
        returnByTime: null
      };
    }

    return {
      pickupStartTime: weeklyAvailability?.pickup_start_time || null,
      returnByTime: weeklyAvailability?.return_by_time || null
    };
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
    // Parse the time string (handles both HH:MM:SS and HH:MM formats)
    const parsed = parse(timeString, 'HH:mm:ss', new Date());
    return format(parsed, 'h:mm a');
  } catch (error) {
    // Try alternative format without seconds
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