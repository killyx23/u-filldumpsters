
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { format, parse, addMinutes, isBefore, isEqual } from 'date-fns';

const cache = new Map();

export function useAvailableTimeSlots(serviceId, date, timeType) {
  const [timeSlots, setTimeSlots] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!serviceId || !date || !timeType) {
      setTimeSlots([]);
      return;
    }

    const dateStr = typeof date === 'string' ? date : format(date, 'yyyy-MM-dd');
    const cacheKey = `${serviceId}-${dateStr}-${timeType}`;

    if (cache.has(cacheKey)) {
      setTimeSlots(cache.get(cacheKey));
      return;
    }

    let isMounted = true;

    const fetchSlots = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('date_specific_availability')
          .select('*')
          .eq('service_id', serviceId)
          .eq('date', dateStr)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Error fetching availability:', error);
          if (isMounted) setTimeSlots([]);
          return;
        }

        let startTimeStr = '09:00:00';
        let endTimeStr = '17:00:00';
        let isAvailable = true;

        if (data) {
          isAvailable = data.is_available;
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

        if (!isAvailable) {
          if (isMounted) {
            setTimeSlots([]);
            cache.set(cacheKey, []);
          }
          return;
        }

        const slots = [];
        const baseDateStr = '2000-01-01';
        let current = parse(`${baseDateStr} ${startTimeStr}`, 'yyyy-MM-dd HH:mm:ss', new Date());
        const end = parse(`${baseDateStr} ${endTimeStr}`, 'yyyy-MM-dd HH:mm:ss', new Date());

        while (isBefore(current, end) || isEqual(current, end)) {
          slots.push({
            value: format(current, 'HH:mm:ss'),
            label: format(current, 'h:mm a')
          });
          current = addMinutes(current, 30);
        }

        if (isMounted) {
          setTimeSlots(slots);
          cache.set(cacheKey, slots);
        }
      } catch (err) {
        console.error('Failed to generate time slots:', err);
        if (isMounted) setTimeSlots([]);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchSlots();

    return () => {
      isMounted = false;
    };
  }, [serviceId, date, timeType]);

  return { timeSlots, isLoading };
}
