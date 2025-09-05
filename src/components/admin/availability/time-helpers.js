import { format, parse } from 'date-fns';

export const formatTime = (timeString, outputFormat = 'h:mm a') => {
  if (!timeString || !/^\d{2}:\d{2}/.test(timeString)) return 'N/A';
  try {
    const date = parse(timeString, 'HH:mm:ss', new Date());
    return format(date, outputFormat);
  } catch (e) {
    return 'Invalid Time';
  }
};

export const formatTimeToDisplay = (timeString) => {
    return formatTime(timeString, 'h:mm a');
};

export const generateTimeOptions = (interval = 30) => {
    const times = [];
    for (let i = 0; i < 24 * (60 / interval); i++) {
        const date = new Date(0, 0, 0, 0, i * interval);
        times.push(format(date, 'HH:mm:ss'));
    }
    return times;
};

export const isValidTime = (timeString) => {
    return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(timeString);
};

export const generate2HourWindows = () => {
    const windows = [];
    for (let i = 0; i < 24; i += 2) {
        const startDate = new Date(0,0,0,i,0);
        const endDate = new Date(0,0,0, i + 2, 0);
        
        const startTime24 = format(startDate, 'HH:mm:ss');
        const endTime24 = format(endDate, 'HH:mm:ss');

        const startTime12 = format(startDate, 'h:mm a');
        const endTime12 = format(endDate, 'h:mm a');
        
        windows.push({
            value: `${startTime24}-${endTime24}`,
            label: `${startTime12} - ${endTime12}`
        });
    }
    return windows;
};

export const timeOptions = generateTimeOptions;
export const timeWindowOptions = generate2HourWindows();