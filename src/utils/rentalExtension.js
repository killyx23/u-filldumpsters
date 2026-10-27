import { addDays, differenceInCalendarDays, eachDayOfInterval, format, parseISO, startOfDay } from 'date-fns';
import { quoteEquipmentExtension } from './rentalEquipmentPricing.js';

const CLOSED_STATUSES = new Set([
  'Completed',
  'flagged',
  'Returned',
  'Cancelled',
  'cancellation_pending',
  'pending_payment',
  'pending_verification',
  'pending_review',
  'pending_checklist',
  'booking_not_finished',
]);

export function roundExtensionMoney(amount) {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

function dateKey(value) {
  if (!value) return '';
  const raw = String(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function parseClockMinutes(value) {
  const raw = String(value || '').trim();
  if (!raw) return 23 * 60;
  const twelve = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (twelve) {
    let hour = parseInt(twelve[1], 10) % 12;
    if (twelve[3].toUpperCase() === 'PM') hour += 12;
    return hour * 60 + parseInt(twelve[2], 10);
  }
  const twentyFour = raw.match(/^(\d{1,2}):(\d{2})/);
  if (twentyFour) return parseInt(twentyFour[1], 10) * 60 + parseInt(twentyFour[2], 10);
  return 23 * 60;
}

function denverNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const LATE_RETURN_WINDOW_MS = 2 * 60 * 60 * 1000;
const UNNOTIFIED_LATE_WINDOW_MINUTES = 3 * 60;

export function rentalReturnDeadlinePassed(booking, now = new Date()) {
  const returnDate = dateKey(booking?.pickup_date);
  if (!returnDate) return true;
  const current = denverNow(now);
  if (current.date > returnDate) return true;
  if (current.date < returnDate) return false;
  return current.minutes >= parseClockMinutes(booking?.pickup_time_slot);
}

function calendarDayDelta(laterDate, earlierDate) {
  const [laterYear, laterMonth, laterDay] = laterDate.split('-').map(Number);
  const [earlierYear, earlierMonth, earlierDay] = earlierDate.split('-').map(Number);
  return Math.round(
    (Date.UTC(laterYear, laterMonth - 1, laterDay) - Date.UTC(earlierYear, earlierMonth - 1, earlierDay)) / 86400000,
  );
}

function minutesAfterScheduledReturn(booking, now = new Date()) {
  const returnDate = dateKey(booking?.pickup_date);
  if (!returnDate) return Number.POSITIVE_INFINITY;
  const current = denverNow(now);
  return calendarDayDelta(current.date, returnDate) * 1440
    + current.minutes
    - parseClockMinutes(booking?.pickup_time_slot);
}

/**
 * After the scheduled return, the customer can still extend until the late-return
 * code expires. That is two hours after the late notice, or three hours after the
 * return time when the notice has not been stamped yet.
 */
export function lateExtensionWindowOpen(booking, now = new Date()) {
  if (!booking || booking.failure_to_return_notice_at || booking.status === 'failure_to_return') return false;
  if (booking.late_return_notice_at) {
    const start = new Date(booking.late_return_notice_at).getTime();
    if (!Number.isFinite(start)) return false;
    return now.getTime() < start + LATE_RETURN_WINDOW_MS;
  }
  const elapsed = minutesAfterScheduledReturn(booking, now);
  return elapsed >= 0 && elapsed < UNNOTIFIED_LATE_WINDOW_MINUTES;
}

export function canExtendBooking(booking, now = new Date()) {
  if (!booking?.id || !dateKey(booking.drop_off_date) || !dateKey(booking.pickup_date)) return false;
  if (booking.pending_address_verification || booking.returned_at) return false;
  if (CLOSED_STATUSES.has(booking.status) || booking.status === 'failure_to_return' || booking.failure_to_return_notice_at) return false;
  if (!rentalReturnDeadlinePassed(booking, now)) return true;
  return lateExtensionWindowOpen(booking, now);
}

export function dayRateFromBooking(booking) {
  const planId = Number(booking?.plan?.id);
  if (planId === 4) return roundExtensionMoney(Number(booking?.plan?.additional_day_rate) || 0);
  if (planId === 1) return 50;
  const base = Number(booking?.plan?.base_price);
  if (base > 0) return roundExtensionMoney(base);
  const dropOff = dateKey(booking?.drop_off_date);
  const pickup = dateKey(booking?.pickup_date);
  const stayDays = dropOff && pickup
    ? Math.max(1, differenceInCalendarDays(parseISO(pickup), parseISO(dropOff)) + 1)
    : 1;
  const price = Number(booking?.plan?.price);
  if (price > 0) return roundExtensionMoney(price / stayDays);
  return 0;
}

function dayIsBlocked(availability, date, { returnDay = false } = {}) {
  const row = availability?.[date];
  if (!row) return true;
  if (row.inventoryAvailable === false) return true;
  if (returnDay && row.available !== true) return true;
  return false;
}

/**
 * Quote an extension to a new return date.
 * Days after the current return must be free. The new return day must also be open.
 */
export function quoteRentalExtension(booking, newPickupDate, availability = {}, catalogRates = {}) {
  const currentPickup = dateKey(booking?.pickup_date);
  const nextReturn = dateKey(newPickupDate);
  const dayRate = dayRateFromBooking(booking);
  const taxRate = Number(booking?.tax_rate_used ?? 7.45);
  if (!currentPickup || !nextReturn || !(dayRate > 0)) {
    return { ok: false, reason: 'invalid' };
  }
  const start = addDays(startOfDay(parseISO(currentPickup)), 1);
  const end = startOfDay(parseISO(nextReturn));
  if (end < start) return { ok: false, reason: 'before_return' };

  const dates = eachDayOfInterval({ start, end }).map((day) => format(day, 'yyyy-MM-dd'));
  const nextDay = dates[0];
  if (dayIsBlocked(availability, nextDay, { returnDay: dates.length === 1 })) {
    return { ok: false, reason: 'next_day_taken', nextDay };
  }
  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    const returnDay = index === dates.length - 1;
    if (dayIsBlocked(availability, date, { returnDay })) {
      return { ok: false, reason: 'gap', date, dates };
    }
  }

  const serviceSubtotal = roundExtensionMoney(dayRate * dates.length);
  const equipment = quoteEquipmentExtension(booking, dates.length, catalogRates);
  const subtotal = roundExtensionMoney(serviceSubtotal + equipment.subtotal);
  const tax = roundExtensionMoney(subtotal * (taxRate / 100));
  const total = roundExtensionMoney(subtotal + tax);
  return {
    ok: true,
    days: dates.length,
    dates,
    dayRate,
    taxRate,
    serviceSubtotal,
    equipmentSubtotal: equipment.subtotal,
    equipmentLines: equipment.lines,
    subtotal,
    tax,
    total,
    currentPickup,
    newPickup: nextReturn,
  };
}

export function extensionOrderLabel(booking) {
  const list = listRentalExtensions(booking);
  if (!list.length) return '';
  const last = list[list.length - 1];
  const amount = Number(last.amount);
  const charged = Number.isFinite(amount) ? ` · $${amount.toFixed(2)}` : '';
  return `Extended · return ${last.original_pickup_date || '—'} → ${last.new_pickup_date || booking?.pickup_date || '—'}${charged}`;
}

export function orderChannelLabel(booking) {
  const extended = extensionOrderLabel(booking);
  if (extended) return 'Extended';
  const channel = String(booking?.addons?.orderChannel || '').toLowerCase();
  if (channel === 'phone') return 'Phone order';
  return 'Online order';
}

export function listRentalExtensions(booking) {
  const history = Array.isArray(booking?.receipt_status_history) ? booking.receipt_status_history : [];
  return history.filter((entry) => entry?.action === 'rental_extended');
}
