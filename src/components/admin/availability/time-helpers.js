import { format, parse } from 'date-fns';

export const formatTime = (timeString, outputFormat = 'h:mm a') => {
  if (!timeString || !/^\d{2}:\d{2}/.test(timeString)) return 'N/A';
  try {
    const date = parse(timeString, 'HH:mm', new Date());
    return format(date, outputFormat);
  } catch (e) {
    return 'Invalid Time';
  }
};

export const generateTimeOptions = (interval = 60) => {
    const times = [];
    for (let i = 0; i < 24 * (60 / interval); i++) {
        const date = new Date(0, 0, 0, 0, i * interval);
        times.push(format(date, 'HH:mm'));
    }
    return times;
};

export const generate2HourWindows = () => {
    const windows = [];
    for (let i = 0; i < 24; i += 2) {
        const startDate = new Date(0,0,0,i,0);
        const endDate = new Date(0,0,0, i + 2, 0);
        
        const startTime24 = format(startDate, 'HH:mm');
        const endTime24 = format(endDate, 'HH:mm');

        const startTime12 = format(startDate, 'h:mm a');
        const endTime12 = format(endDate, 'h:mm a');
        
        windows.push({
            value: `${startTime24}-${endTime24}`,
            label: `${startTime12} - ${endTime12}`
        });
    }
    return windows;
};

export const timeOptions = generateTimeOptions(60);
export const timeWindowOptions = generate2HourWindows();