import { supabase } from '@/lib/customSupabaseClient';

/**
 * When a booking leaves manual review back to Confirmed, PIN may have been revoked on the lock
 * while pin_generated_at stayed set — daily PIN cron only picks rows with pin_generated_at IS NULL.
 * Merge this into the bookings update payload when transitioning pending_review → Confirmed.
 */
export function reinstatePinTrackingPatch(previousStatus, nextStatus) {
  if (previousStatus === 'pending_review' && nextStatus === 'Confirmed') {
    return {
      pin_generated_at: null,
      pin_notification_sent_at: null,
    };
  }
  return {};
}

/** Avoid duplicate "active" rows before cron inserts a fresh PIN. */
export async function expireActiveRentalAccessCodesForOrder(orderId) {
  const { error } = await supabase
    .from('rental_access_codes')
    .update({ status: 'expired' })
    .eq('order_id', orderId)
    .eq('status', 'active');

  if (error) {
    console.warn('[bookingPinReinstate] Could not expire active access codes:', error.message);
  }
}
