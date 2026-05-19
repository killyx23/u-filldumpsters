import { supabase } from '@/lib/customSupabaseClient';

/**
 * Creates a tax record for audit tracking after successful booking payment
 * @param {number} bookingId - The booking ID
 * @param {number} taxAmount - Tax amount charged
 * @param {number} taxRate - Tax rate percentage used (e.g., 7.45 for 7.45%)
 * @param {number} subtotalBeforeTax - Subtotal before tax was applied
 * @param {Object} [auditExtras] - Extended audit fields (optional)
 * @returns {Promise<Object>} Created tax record or error
 */
export async function createTaxRecord(bookingId, taxAmount, taxRate, subtotalBeforeTax, auditExtras = {}) {
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] [createTaxRecord] Creating tax record for booking ${bookingId}`, {
    taxAmount,
    taxRate,
    subtotalBeforeTax,
    auditExtras
  });

  try {
    if (!bookingId || typeof bookingId !== 'number') {
      throw new Error('Invalid booking ID');
    }

    if (typeof taxAmount !== 'number' || taxAmount < 0) {
      throw new Error('Invalid tax amount');
    }

    if (typeof taxRate !== 'number' || taxRate < 0) {
      throw new Error('Invalid tax rate');
    }

    if (typeof subtotalBeforeTax !== 'number' || subtotalBeforeTax < 0) {
      throw new Error('Invalid subtotal');
    }

    const taxRecordPayload = {
      booking_id: bookingId,
      tax_amount: taxAmount,
      tax_rate: taxRate,
      subtotal_before_tax: subtotalBeforeTax,
      ...(auditExtras.delivery_type != null && { delivery_type: auditExtras.delivery_type }),
      ...(auditExtras.taxable_subtotal != null && { taxable_subtotal: auditExtras.taxable_subtotal }),
      ...(auditExtras.non_taxable_subtotal != null && { non_taxable_subtotal: auditExtras.non_taxable_subtotal }),
      ...(auditExtras.line_items != null && { line_items: auditExtras.line_items }),
      ...(auditExtras.tax_jurisdiction != null && { tax_jurisdiction: auditExtras.tax_jurisdiction }),
      ...(auditExtras.tax_api_used != null && { tax_api_used: auditExtras.tax_api_used }),
    };

    const { data: taxRecord, error: taxRecordError } = await supabase
      .from('tax_records')
      .insert(taxRecordPayload)
      .select()
      .single();

    if (taxRecordError) {
      console.error(`[${timestamp}] [createTaxRecord] Error inserting tax record:`, taxRecordError);
      throw taxRecordError;
    }

    const { error: bookingUpdateError } = await supabase
      .from('bookings')
      .update({
        tax_amount: taxAmount,
        tax_rate_used: taxRate,
        subtotal_before_tax: subtotalBeforeTax,
        ...(auditExtras.delivery_type != null && { delivery_type: auditExtras.delivery_type }),
        ...(auditExtras.tax_jurisdiction != null && { tax_jurisdiction: auditExtras.tax_jurisdiction }),
      })
      .eq('id', bookingId);

    if (bookingUpdateError) {
      console.warn(`[${timestamp}] [createTaxRecord] Failed to update booking with tax info:`, bookingUpdateError);
    }

    console.log(`[${timestamp}] [createTaxRecord] ✓ Tax record created successfully:`, taxRecord.id);

    return {
      success: true,
      taxRecord,
      error: null
    };

  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] [createTaxRecord] Failed to create tax record:`, {
      bookingId,
      error: error.message,
      stack: error.stack
    });

    return {
      success: false,
      taxRecord: null,
      error: error.message
    };
  }
}

/**
 * Retrieves tax records for a booking
 * @param {number} bookingId - The booking ID
 * @returns {Promise<Array>} Tax records for the booking
 */
export async function getTaxRecordsForBooking(bookingId) {
  try {
    const { data, error } = await supabase
      .from('tax_records')
      .select('*')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('[getTaxRecordsForBooking] Error:', error);
    return [];
  }
}

/**
 * Retrieves tax records for a date range
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Tax records in date range
 */
export async function getTaxRecordsForDateRange(startDate, endDate) {
  try {
    const { data, error } = await supabase
      .from('tax_records')
      .select(`
        *,
        bookings (
          id,
          customers (
            name,
            email
          ),
          plan
        )
      `)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('[getTaxRecordsForDateRange] Error:', error);
    return [];
  }
}
