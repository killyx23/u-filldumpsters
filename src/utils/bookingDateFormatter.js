import { format, isValid } from 'date-fns';

export const parseBookingDateOnly = (date) => {
  if (!date) return null;
  if (date instanceof Date) return date;

  const dateString = String(date);
  const dateOnlyMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  return new Date(dateString);
};

export const formatBookingDateOnly = (date, formatString = 'MMM d, yyyy', fallback = 'N/A') => {
  const parsedDate = parseBookingDateOnly(date);

  if (!parsedDate || !isValid(parsedDate)) {
    return fallback;
  }

  return format(parsedDate, formatString);
};