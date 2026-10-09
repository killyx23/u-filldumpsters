import { differenceInHours } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { DEFAULT_FEES, mapFeeRowsToConfig } from '@/utils/chargesAndFeesConfig';
import { getBookingDateTime } from '@/utils/bookingPickupWindow';

/**
 * Same advance/late split the customer cancel dialog uses:
 * within 24 hours of the appointment, late_cancel_percentage; otherwise advance.
 * @param {object} booking
 * @param {Record<string, number>} [fees]
 * @param {Date} [now]
 */
export function computeCancellationFee(booking, fees = {}, now = new Date()) {
  const merged = { ...DEFAULT_FEES, ...fees };
  const appointmentDate = getBookingDateTime(booking?.drop_off_date, booking?.drop_off_time_slot);
  const hoursUntil = appointmentDate ? differenceInHours(appointmentDate, now) : null;
  const isLate = hoursUntil !== null && hoursUntil <= 24;
  const percentage = Number(isLate ? merged.late_cancel_percentage : merged.advance_cancel_percentage);
  const total = Number(booking?.total_price || 0);
  const feeAmount = parseFloat(((percentage / 100) * total).toFixed(2));
  return {
    feeType: isLate ? 'late' : 'advance',
    percentage,
    feeAmount,
    refundAmount: parseFloat(Math.max(0, total - feeAmount).toFixed(2)),
    hoursUntil,
    total,
  };
}

export async function loadCancellationFee(booking, now = new Date()) {
  const { data, error } = await supabase.from('charges_and_fees').select('fee_key, fee_value');
  if (error) {
    console.warn('[cancellationFee] Could not load charges_and_fees:', error.message);
  }
  return computeCancellationFee(booking, mapFeeRowsToConfig(data), now);
}
