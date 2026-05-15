import { supabase } from '@/lib/customSupabaseClient';

const PIN_DELETE_STATUSES = new Set(['Cancelled', 'pending_review']);

export const shouldDeletePinForStatus = (status) => PIN_DELETE_STATUSES.has(status);

/**
 * Generate patch object to reset PIN tracking fields when transitioning from pending_review to Confirmed
 * 
 * This function determines if PIN-related fields should be cleared based on booking status transition.
 * When a booking moves from 'pending_review' back to 'Confirmed', we need to reset PIN tracking
 * so a new PIN can be generated through the normal flow.
 * 
 * @param {string} previousStatus - The previous booking status
 * @param {string} newStatus - The new booking status being applied
 * @returns {Object} Patch object containing PIN field resets, or empty object if no reset needed
 * 
 * @example
 * // Transitioning from pending_review to Confirmed - resets PIN fields
 * reinstatePinTrackingPatch('pending_review', 'Confirmed')
 * // Returns: { pin_generated_at: null, pin_notification_sent_at: null }
 * 
 * @example
 * // Any other transition - no PIN reset
 * reinstatePinTrackingPatch('Confirmed', 'Delivered')
 * // Returns: {}
 */
export function reinstatePinTrackingPatch(previousStatus, newStatus) {
  // Check if we're transitioning FROM pending_review TO Confirmed
  if (previousStatus === 'pending_review' && newStatus === 'Confirmed') {
    console.log('[reinstatePinTrackingPatch] Resetting PIN tracking fields for pending_review -> Confirmed transition');
    return {
      pin_generated_at: null,
      pin_notification_sent_at: null
    };
  }
  
  // No PIN reset needed for other transitions
  return {};
}

/**
 * Expire all active rental access codes (PINs) for a specific booking
 * 
 * This first calls the delete-pin edge function, which expires the PIN in the
 * database and attempts bridge deletion. If the edge call fails to confirm DB
 * expiry, this falls back to expiring active rows locally so portal access is
 * still revoked.
 * 
 * @async
 * @param {number|bigint} orderId - The booking ID whose PINs should be expired
 * @param {'admin'|'customer'} callerType - Auth context delete-pin should verify
 * @returns {Promise<Object>} Result object containing:
 *   - success {boolean} - Whether the operation completed successfully
 *   - expiredCount {number} - Number of PINs that were expired
 *   - error {string} [optional] - Error message if operation failed
 * 
 * @example
 * // Expire PINs when booking is moved to pending_review
 * const result = await expireActiveRentalAccessCodesForOrder(12345);
 * if (result.success) {
 *   console.log(`Expired ${result.expiredCount} active PINs`);
 * }
 */
export async function expireActiveRentalAccessCodesForOrder(orderId, callerType = 'admin') {
  if (!orderId) {
    console.warn('[expireActiveRentalAccessCodesForOrder] No order ID provided');
    return { success: false, expiredCount: 0, error: 'Order ID is required' };
  }

  try {
    console.log(`[expireActiveRentalAccessCodesForOrder] Expiring active PINs for booking #${orderId}`);

    // Query for active rental access codes for this order
    const { data: activeCodes, error: fetchError } = await supabase
      .from('rental_access_codes')
      .select('id, access_pin, pin_id')
      .eq('order_id', orderId)
      .eq('status', 'active');

    if (fetchError) {
      console.error('[expireActiveRentalAccessCodesForOrder] Error fetching active codes:', fetchError);
      return { success: false, expiredCount: 0, error: fetchError.message };
    }

    // If no active codes found, nothing to do
    if (!activeCodes || activeCodes.length === 0) {
      console.log(`[expireActiveRentalAccessCodesForOrder] No active PINs found for booking #${orderId}`);
      return { success: true, expiredCount: 0 };
    }

    console.log(`[expireActiveRentalAccessCodesForOrder] Found ${activeCodes.length} active PIN(s) to expire`);

    const { data: deleteData, error: deleteError } = await supabase.functions.invoke('delete-pin', {
      body: {
        bookingId: orderId,
        callerType,
      },
    });

    if (!deleteError && deleteData?.dbExpired === true) {
      console.log(`[expireActiveRentalAccessCodesForOrder] delete-pin revoked portal access for booking #${orderId}`, deleteData);
      return {
        success: true,
        expiredCount: activeCodes.length,
        lockDeleted: deleteData.lockDeleted === true,
        dbExpired: true,
        message: deleteData.message,
      };
    }

    if (deleteError) {
      console.warn('[expireActiveRentalAccessCodesForOrder] delete-pin failed; falling back to local DB expiry:', deleteError.message);
    } else {
      console.warn('[expireActiveRentalAccessCodesForOrder] delete-pin did not confirm DB expiry; falling back to local DB expiry:', deleteData);
    }

    // Update all active codes to expired status
    const { error: updateError } = await supabase
      .from('rental_access_codes')
      .update({ status: 'expired' })
      .eq('order_id', orderId)
      .eq('status', 'active');

    if (updateError) {
      console.error('[expireActiveRentalAccessCodesForOrder] Error updating codes to expired:', updateError);
      return { success: false, expiredCount: 0, error: updateError.message };
    }

    const expiredCount = activeCodes.length;
    console.log(`[expireActiveRentalAccessCodesForOrder] ✓ Successfully expired ${expiredCount} PIN(s) for booking #${orderId}`);
    
    // Log each expired PIN for audit trail
    activeCodes.forEach(code => {
      console.log(`  - Expired PIN: ${code.access_pin} (pin_id: ${code.pin_id})`);
    });

    return { success: true, expiredCount };

  } catch (error) {
    // Catch any unexpected errors and log them
    console.error('[expireActiveRentalAccessCodesForOrder] Unexpected error:', error);
    return { 
      success: false, 
      expiredCount: 0, 
      error: error.message || 'Unknown error occurred' 
    };
  }
}