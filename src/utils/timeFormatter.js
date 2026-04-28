export const formatTo12Hour = (time24) => {
    if (!time24) return '';
    // Handle formats like "14:30:00" or "14:30"
    const [hourStr, minuteStr] = time24.split(':');
    const hour = parseInt(hourStr, 10);
    if (isNaN(hour)) return time24;
    
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    
    return `${hour12}:${minuteStr || '00'} ${ampm}`;
};

export const formatTimeRange = (startTime24, endTime24) => {
    if (!startTime24 || !endTime24) return '';
    return `${formatTo12Hour(startTime24)} - ${formatTo12Hour(endTime24)}`;
};

export const parse12HourTo24 = (time12) => {
    if (!time12) return '';
    const [time, modifier] = time12.split(' ');
    if (!modifier) return time12; // fallback if already 24h
    
    let [hours, minutes] = time.split(':');
    if (hours === '12') {
        hours = '00';
    }
    if (modifier.toUpperCase() === 'PM') {
        hours = parseInt(hours, 10) + 12;
    }
    return `${hours.toString().padStart(2, '0')}:${minutes}:00`;
};