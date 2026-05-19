
import { supabase } from '@/lib/customSupabaseClient';

/**
 * EMAIL DEDUPLICATION PATTERN
 * ===========================
 * This file implements a check-before-insert pattern to prevent duplicate email errors
 * in the pending_customers table. The pattern is:
 * 
 * 1. Check if email already exists in pending_customers
 * 2. If exists:
 *    - UPDATE the existing record with new booking data, setting is_verified back to false
 *    - Return the existing token for email verification
 * 3. If doesn't exist:
 *    - INSERT new record
 * 
 * IMPORTANT: Do NOT bypass this pattern. Always use storePendingBooking() to create
 * pending customer records. Direct inserts may cause duplicate email errors.
 */

/**
 * Stores or updates a pending booking in the database with email deduplication
 * @param {Object} bookingData - Contact and booking information
 * @param {Object} plan - Selected service plan
 * @param {Object} addonsData - Selected add-ons and additional data
 * @param {Object} options - Additional options including pricing data
 * @returns {Promise<{success: boolean, token?: string, error?: string}>}
 */
export async function storePendingBooking(bookingData, plan, addonsData, options = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [storePendingBooking] Starting with email: ${bookingData.email}`);

  try {
    const email = bookingData.email?.trim().toLowerCase();
    
    if (!email) {
      console.error(`[${timestamp}] [storePendingBooking] No email provided`);
      return {
        success: false,
        error: 'Email address is required'
      };
    }

    // STEP 1: Check if email already exists in pending_customers
    console.log(`[${timestamp}] [storePendingBooking] Checking for existing email: ${email}`);
    
    const { data: existingRecord, error: checkError } = await supabase
      .from('pending_customers')
      .select('id, email, is_verified, created_at')
      .eq('email', email)
      .maybeSingle();

    if (checkError) {
      console.error(`[${timestamp}] [storePendingBooking] Error checking existing email:`, checkError);
      return {
        success: false,
        error: 'Failed to verify email availability. Please try again.'
      };
    }

    // Prepare the booking data payload
    const bookingPayload = {
      email: email,
      first_name: bookingData.firstName?.trim() || null,
      last_name: bookingData.lastName?.trim() || null,
      name: `${bookingData.firstName || ''} ${bookingData.lastName || ''}`.trim() || null,
      phone: bookingData.phone?.replace(/\D/g, '') || null,
      street: bookingData.contactAddress?.street || null,
      city: bookingData.contactAddress?.city || null,
      state: bookingData.contactAddress?.state || null,
      zip: bookingData.contactAddress?.zip || null,
      contact_address: bookingData.contactAddress || null,
      delivery_address: addonsData?.deliveryAddress || bookingData.contactAddress || null,
      drop_off_date: bookingData.dropOffDate || null,
      pickup_date: bookingData.pickupDate || null,
      drop_off_time_slot: bookingData.dropOffTimeSlot || null,
      pickup_time_slot: bookingData.pickupTimeSlot || null,
      notes: bookingData.notes || null,
      service_id: plan?.id || null,
      plan_data: plan || null,
      addons_data: addonsData || null,
      booking_data: bookingData || null,
      is_verified: false,
      verified_at: null,
      total_price: options.totalPrice || null,
      subtotal_before_tax: options.subtotalBeforeTax ?? null,
      base_price: options.basePrice || null,
      delivery_service: options.deliveryService || false
    };

    // STEP 2: Handle existing email
    if (existingRecord) {
      console.log(`[${timestamp}] [storePendingBooking] Found existing record:`, {
        id: existingRecord.id,
        is_verified: existingRecord.is_verified,
        created_at: existingRecord.created_at
      });

      // Update the existing record regardless of verification status
      console.log(`[${timestamp}] [storePendingBooking] Updating existing record to unverified with new details`);
      
      const { data: updatedRecord, error: updateError } = await supabase
        .from('pending_customers')
        .update(bookingPayload)
        .eq('id', existingRecord.id)
        .select('id')
        .single();

      if (updateError) {
        console.error(`[${timestamp}] [storePendingBooking] Update failed:`, updateError);
        return {
          success: false,
          error: 'Failed to update booking information. Please try again.'
        };
      }

      console.log(`[${timestamp}] [storePendingBooking] ✓ Successfully updated existing record`);
      
      // Return the existing record ID as token
      return {
        success: true,
        token: existingRecord.id
      };
    }

    // STEP 3: No existing record - INSERT new one
    console.log(`[${timestamp}] [storePendingBooking] No existing record found - inserting new`);
    
    const { data: newRecord, error: insertError } = await supabase
      .from('pending_customers')
      .insert([bookingPayload])
      .select('id')
      .single();

    if (insertError) {
      console.error(`[${timestamp}] [storePendingBooking] Insert failed:`, insertError);
      
      // Check if this is a duplicate key error that slipped through
      if (insertError.code === '23505' || insertError.message?.includes('duplicate')) {
        console.warn(`[${timestamp}] [storePendingBooking] Race condition detected - duplicate email`);
        return {
          success: false,
          error: 'This email was just registered by another request. Please refresh and try again.'
        };
      }
      
      return {
        success: false,
        error: 'Failed to save booking information. Please try again.'
      };
    }

    console.log(`[${timestamp}] [storePendingBooking] ✓ Successfully inserted new record:`, newRecord.id);
    
    return {
      success: true,
      token: newRecord.id
    };

  } catch (error) {
    const catchTs = new Date().toISOString();
    console.error(`[${catchTs}] [storePendingBooking] Unexpected error:`, error);
    return {
      success: false,
      error: 'An unexpected error occurred. Please try again.'
    };
  }
}

/**
 * Retrieves a pending booking by token (UUID)
 * @param {string} token - The pending_customers UUID
 * @returns {Promise<{success: boolean, bookingData?: Object, error?: string}>}
 */
export async function retrievePendingBooking(token) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [retrievePendingBooking] Fetching token: ${token}`);

  try {
    if (!token) {
      return {
        success: false,
        error: 'No booking reference provided'
      };
    }

    const { data, error } = await supabase
      .from('pending_customers')
      .select('*')
      .eq('id', token)
      .single();

    if (error) {
      console.error(`[${timestamp}] [retrievePendingBooking] Query error:`, error);
      return {
        success: false,
        error: 'Could not find your booking. The link may have expired.'
      };
    }

    if (!data) {
      console.warn(`[${timestamp}] [retrievePendingBooking] No record found for token`);
      return {
        success: false,
        error: 'Booking not found. Please start a new booking.'
      };
    }

    console.log(`[${timestamp}] [retrievePendingBooking] ✓ Successfully retrieved record`);
    
    return {
      success: true,
      bookingData: data
    };

  } catch (error) {
    console.error(`[${timestamp}] [retrievePendingBooking] Unexpected error:`, error);
    return {
      success: false,
      error: 'Failed to retrieve booking information.'
    };
  }
}

/**
 * Marks a pending customer as verified
 * @param {string} email - Customer email address
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function markPendingCustomerVerified(email) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [markPendingCustomerVerified] Marking email as verified: ${email}`);

  try {
    const { error } = await supabase
      .from('pending_customers')
      .update({ 
        is_verified: true,
        verified_at: new Date().toISOString()
      })
      .eq('email', email.trim().toLowerCase());

    if (error) {
      console.error(`[${timestamp}] [markPendingCustomerVerified] Update error:`, error);
      return {
        success: false,
        error: 'Failed to mark email as verified'
      };
    }

    console.log(`[${timestamp}] [markPendingCustomerVerified] ✓ Email marked as verified`);
    return { success: true };

  } catch (error) {
    console.error(`[${timestamp}] [markPendingCustomerVerified] Unexpected error:`, error);
    return {
      success: false,
      error: 'Unexpected error during verification'
    };
  }
}
