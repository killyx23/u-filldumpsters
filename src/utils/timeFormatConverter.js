
/**
 * Utility to convert 24-hour time to 12-hour AM/PM format
 */

export const convertTo12Hour = (time24) => {
    if (!time24) return '';
    
    // Check if already in 12-hour format
    if (time24.toLowerCase().includes('am') || time24.toLowerCase().includes('pm')) {
        return time24;
    }

    try {
        const [hourStr, minuteStr] = time24.split(':');
        const hour = parseInt(hourStr, 10);
        
        if (isNaN(hour)) return time24;
        
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        
        return `${hour12}:${minuteStr || '00'} ${ampm}`;
    } catch (e) {
        console.error("Time conversion error:", e);
        return time24;
    }
};

export const formatTimeRange12Hour = (startTime24, endTime24) => {
    if (!startTime24 || !endTime24) return '';
    return `${convertTo12Hour(startTime24)} - ${convertTo12Hour(endTime24)}`;
};
