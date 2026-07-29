import { supabase } from '@/lib/customSupabaseClient';
import { format, parse, addDays, startOfDay } from 'date-fns';

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

function toDateStr(date) {
  if (!date) return null;
  if (typeof date === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.split('T')[0];
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return null;
    return format(parsed, 'yyyy-MM-dd');
  }
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    return format(date, 'yyyy-MM-dd');
  }
  return null;
}

/**
 * Admin Closed status for a service on one date.
 * Uses date_specific_availability first, then weekly service_availability.
 * Closed when is_available === false. No rule → closed (no open schedule that day).
 * Does NOT consider inventory capacity.
 */
export async function isServiceClosedOnDate(serviceId, date) {
  const dateStr = toDateStr(date);
  if (!serviceId || !dateStr) return true;

  const dateObj = startOfDay(new Date(`${dateStr}T12:00:00`));
  const dayOfWeek = dateObj.getDay();

  const { data: dateSpecific, error: dateError } = await supabase
    .from('date_specific_availability')
    .select('is_available')
    .eq('service_id', serviceId)
    .eq('date', dateStr)
    .maybeSingle();

  if (dateError) {
    console.warn('[ServiceAvailability] Closed check date-specific error:', dateError);
  }

  if (dateSpecific != null && dateSpecific.is_available != null) {
    return dateSpecific.is_available === false;
  }

  const { data: weekly, error: weeklyError } = await supabase
    .from('service_availability')
    .select('is_available')
    .eq('service_id', serviceId)
    .eq('day_of_week', dayOfWeek)
    .maybeSingle();

  if (weeklyError) {
    console.warn('[ServiceAvailability] Closed check weekly error:', weeklyError);
  }

  if (weekly != null && weekly.is_available != null) {
    return weekly.is_available === false;
  }

  // No admin rule for this day → treat as closed / not open for delivery
  return true;
}

/**
 * True when the service is Closed for every day in [startDate, endDate] (inclusive).
 * Admin Closed only — ignores inventory.
 */
export async function isServiceClosedForEntireRange(serviceId, startDate, endDate) {
  const startStr = toDateStr(startDate);
  const endStr = toDateStr(endDate);
  if (!serviceId || !startStr || !endStr) return true;

  const start = startOfDay(new Date(`${startStr}T12:00:00`));
  const end = startOfDay(new Date(`${endStr}T12:00:00`));
  if (end < start) return true;

  const dateList = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    dateList.push(format(d, 'yyyy-MM-dd'));
  }

  const { data: dateSpecificRows, error: dateError } = await supabase
    .from('date_specific_availability')
    .select('date, is_available')
    .eq('service_id', serviceId)
    .gte('date', startStr)
    .lte('date', endStr);

  if (dateError) {
    console.warn('[ServiceAvailability] Closed range date-specific error:', dateError);
  }

  const specificByDate = new Map(
    (dateSpecificRows || []).map((row) => [row.date, row.is_available !== false])
  );

  const { data: weeklyRows, error: weeklyError } = await supabase
    .from('service_availability')
    .select('day_of_week, is_available')
    .eq('service_id', serviceId);

  if (weeklyError) {
    console.warn('[ServiceAvailability] Closed range weekly error:', weeklyError);
  }

  const weeklyByDow = new Map(
    (weeklyRows || []).map((row) => [Number(row.day_of_week), row.is_available !== false])
  );

  for (const dateStr of dateList) {
    if (specificByDate.has(dateStr)) {
      if (specificByDate.get(dateStr)) return false; // at least one open day
      continue;
    }
    const dow = startOfDay(new Date(`${dateStr}T12:00:00`)).getDay();
    if (weeklyByDow.has(dow) && weeklyByDow.get(dow)) {
      return false; // weekly open for this weekday
    }
  }

  return true; // every day closed
}

/**
 * Whether Dump Loader delivery (service 4) should block the Need delivery checkbox.
 * - With a selected date: closed that day only.
 * - Without a date: closed for the entire next `daysAhead` window.
 */
export async function isDeliveryServiceClosedForBooking(deliveryServiceId, selectedDate, daysAhead = 30) {
  const serviceId = Number(deliveryServiceId) || 4;
  if (selectedDate) {
    return isServiceClosedOnDate(serviceId, selectedDate);
  }
  const today = startOfDay(new Date());
  return isServiceClosedForEntireRange(serviceId, today, addDays(today, daysAhead));
}
