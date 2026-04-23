
import { supabase } from '@/lib/customSupabaseClient';
import { format, parse, isBefore, isAfter } from 'date-fns';

export async function validateTimeAgainstAvailability(serviceId, date, selectedTime, timeType) {
  if (!serviceId || !date || !selectedTime || !timeType) return false;

  const dateStr = typeof date === 'string' ? date : format(date, 'yyyy-MM-dd');

  try {
    const { data, error } = await supabase
      .from('date_specific_availability')
      .select('*')
      .eq('service_id', serviceId)
      .eq('date', dateStr)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error validating time:', error);
      return false;
    }

    if (data && !data.is_available) return false;

    let startTimeStr = '09:00:00';
    let endTimeStr = '17:00:00';

    if (data) {
      if (timeType === 'delivery') {
        startTimeStr = data.delivery_start_time || startTimeStr;
        endTimeStr = data.delivery_end_time || endTimeStr;
      } else if (timeType === 'pickup') {
        startTimeStr = data.pickup_start_time || startTimeStr;
        endTimeStr = data.pickup_end_time || endTimeStr;
      } else if (timeType === 'return') {
        startTimeStr = data.return_start_time || startTimeStr;
        endTimeStr = data.return_end_time || endTimeStr;
      } else if (timeType === 'hourly') {
        startTimeStr = data.hourly_start_time || startTimeStr;
        endTimeStr = data.hourly_end_time || endTimeStr;
      }
    }

    const baseDate = '2000-01-01';
    const start = parse(`${baseDate} ${startTimeStr}`, 'yyyy-MM-dd HH:mm:ss', new Date());
    const end = parse(`${baseDate} ${endTimeStr}`, 'yyyy-MM-dd HH:mm:ss', new Date());
    
    let selectedTimeFmt = selectedTime;
    if (!selectedTime.includes(':')) {
       selectedTimeFmt = `${selectedTime}:00`;
    }
    if (selectedTimeFmt.length === 5) {
        selectedTimeFmt = `${selectedTimeFmt}:00`;
    }
    
    const selected = parse(`${baseDate} ${selectedTimeFmt}`, 'yyyy-MM-dd HH:mm:ss', new Date());

    if (isBefore(selected, start) || isAfter(selected, end)) {
      return false;
    }

    return true;
  } catch (err) {
    console.error('Time validation failed:', err);
    return false;
  }
}
