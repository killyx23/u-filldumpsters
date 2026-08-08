import { format, parse } from 'date-fns';

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

export const getIncrementForService = (serviceId) => {
    // 1-hour for trailer (2) and mini excavator (5)
    // 2-hours for dumpster (1), rock/mulch (3), delivery trailer (4)
    return serviceId === 2 || serviceId === 5 ? 60 : 120;
};