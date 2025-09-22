import { format, parse, set, addMinutes, isBefore } from 'date-fns';

export const formatTimeForDisplay = (timeString, outputFormat = 'h:mm a') => {
  if (!timeString || !/^\d{2}:\d{2}/.test(timeString)) return 'N/A';
  try {
    const date = parse(timeString, 'HH:mm:ss', new Date());
    return format(date, outputFormat);
  } catch (e) {
    return 'Invalid Time';
  }
};

export const generateTimeSlotOptions = (intervalMinutes = 30) => {
    const options = [];
    const iterations = (24 * 60) / intervalMinutes;
    for (let i = 0; i < iterations; i++) {
        const date = new Date(0, 0, 0, 0, i * intervalMinutes);
        options.push({
            value: format(date, 'HH:mm:ss'),
            label: format(date, 'h:mm a')
        });
    }
    // Add end of day option
    options.push({ value: '23:59:59', label: '11:59 PM'});
    return options;
};

export const generateSlotsFromRange = (startTime, endTime, intervalMinutes, currentDate, now) => {
    if (!startTime || !endTime) return [];
    
    let start = parse(startTime, 'HH:mm:ss', currentDate);
    const end = parse(endTime, 'HH:mm:ss', currentDate);

    // If the date is today, adjust start time to be at least 2 hours from now
    if (isBefore(start, now) && isBefore(start, end)) {
        start = now;
        
        const twoHoursFromNow = addMinutes(start, 120);
        if (isBefore(start, twoHoursFromNow)) {
          start = twoHoursFromNow;
        }
    }
    
    // Round up to the next slot interval
    const minutes = start.getMinutes();
    const roundedMinutes = Math.ceil(minutes / intervalMinutes) * intervalMinutes;
    let currentTime = set(start, { minutes: roundedMinutes, seconds: 0, milliseconds: 0 });

    const slots = [];
    while (isBefore(currentTime, end)) {
        const slotEnd = addMinutes(currentTime, intervalMinutes);
        if (isBefore(slotEnd, addMinutes(end, 1))) { // allows slot to end exactly at end time
            slots.push({
                start: format(currentTime, 'HH:mm:ss'),
                end: format(slotEnd, 'HH:mm:ss'),
                label: `${format(currentTime, 'h:mm a')} - ${format(slotEnd, 'h:mm a')}`
            });
        }
        currentTime = addMinutes(currentTime, intervalMinutes);
    }
    return slots;
};