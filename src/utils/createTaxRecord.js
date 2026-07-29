import { supabase } from '@/lib/customSupabaseClient';

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildTaxPayload(bookingId, taxAmount, taxRate, subtotalBeforeTax, snapshot = {}) {
  const addons = snapshot.addons && typeof snapshot.addons === 'object' ? snapshot.addons : {};
  let deliveryType = snapshot.delivery_type || addons.deliveryType || null;
  if (deliveryType && !['delivery', 'self_service_trailer', 'self_pickup'].includes(deliveryType)) {
    deliveryType = null;
  }

  return {
    booking_id: bookingId,
    tax_amount: toNumber(taxAmount),
    tax_rate: toNumber(taxRate),
    subtotal_before_tax: toNumber(subtotalBeforeTax),
    taxable_subtotal: toNumber(
      snapshot.taxable_subtotal ?? addons.taxableSubtotal,
      toNumber(subtotalBeforeTax)
    ),
    non_taxable_subtotal: toNumber(snapshot.non_taxable_subtotal ?? addons.nonTaxableSubtotal, 0),
    line_items: snapshot.line_items ?? addons.taxLineItemsSnapshot ?? [],
    delivery_type: deliveryType,
    tax_jurisdiction: snapshot.tax_jurisdiction || addons.taxJurisdiction || null,
    tax_api_used: snapshot.tax_api_used || addons.taxApiUsed || 'business_settings',
    voided_at: null,
    void_reason: null,
  };
}

/**
 * Upserts a tax ledger row for a booking (one row per booking_id).
 * @param {number} bookingId
 * @param {number} taxAmount
 * @param {number} taxRate - percent e.g. 7.45
 * @param {number} subtotalBeforeTax
 * @param {object} [snapshot] - optional booking/addons fields for richer audit
 */
export async function createTaxRecord(bookingId, taxAmount, taxRate, subtotalBeforeTax, snapshot = {}) {
  const timestamp = new Date().toISOString();
  const numericBookingId = Number(bookingId);

  console.log(`[${timestamp}] [createTaxRecord] Upserting tax record for booking ${numericBookingId}`, {
    taxAmount,
    taxRate,
    subtotalBeforeTax,
  });

  try {
    if (!Number.isFinite(numericBookingId) || numericBookingId <= 0) {
      throw new Error('Invalid booking ID');
    }
    if (typeof taxAmount !== 'number' || taxAmount < 0 || Number.isNaN(taxAmount)) {
      throw new Error('Invalid tax amount');
    }
    if (typeof taxRate !== 'number' || taxRate < 0 || Number.isNaN(taxRate)) {
      throw new Error('Invalid tax rate');
    }
    if (typeof subtotalBeforeTax !== 'number' || subtotalBeforeTax < 0 || Number.isNaN(subtotalBeforeTax)) {
      throw new Error('Invalid subtotal');
    }

    let enriched = { ...snapshot };
    if (!enriched.addons) {
      const { data: bookingRow } = await supabase
        .from('bookings')
        .select('addons, delivery_type, tax_jurisdiction, status')
        .eq('id', numericBookingId)
        .maybeSingle();
      if (bookingRow) {
        enriched = {
          ...enriched,
          addons: bookingRow.addons,
          delivery_type: enriched.delivery_type ?? bookingRow.delivery_type,
          tax_jurisdiction: enriched.tax_jurisdiction ?? bookingRow.tax_jurisdiction,
          status: bookingRow.status,
        };
      }
    }

    const payload = buildTaxPayload(
      numericBookingId,
      taxAmount,
      taxRate,
      subtotalBeforeTax,
      enriched
    );

    if (enriched.status === 'Cancelled') {
      payload.voided_at = new Date().toISOString();
      payload.void_reason = 'Booking cancelled';
    }

    const { data: taxRecord, error: taxRecordError } = await supabase
      .from('tax_records')
      .upsert(payload, { onConflict: 'booking_id' })
      .select()
      .single();

    if (taxRecordError) {
      // Fallback: RPC upsert if unique constraint name differs in older DBs
      const { data: rpcId, error: rpcError } = await supabase.rpc('upsert_booking_tax_record', {
        p_booking_id: numericBookingId,
      });
      if (rpcError) {
        console.error(`[${timestamp}] [createTaxRecord] Error upserting tax record:`, taxRecordError, rpcError);
        throw taxRecordError;
      }
      return {
        success: true,
        taxRecord: { id: rpcId, booking_id: numericBookingId, ...payload },
        error: null,
      };
    }

    const { error: bookingUpdateError } = await supabase
      .from('bookings')
      .update({
        tax_amount: taxAmount,
        tax_rate_used: taxRate,
        subtotal_before_tax: subtotalBeforeTax,
      })
      .eq('id', numericBookingId);

    if (bookingUpdateError) {
      console.warn(`[${timestamp}] [createTaxRecord] Failed to update booking with tax info:`, bookingUpdateError);
    }

    console.log(`[${timestamp}] [createTaxRecord] ✓ Tax record upserted:`, taxRecord.id);

    return {
      success: true,
      taxRecord,
      error: null,
    };
  } catch (error) {
    const errorTimestamp = new Date().toISOString();
    console.error(`[${errorTimestamp}] [createTaxRecord] Failed to create tax record:`, {
      bookingId: numericBookingId,
      error: error.message,
      stack: error.stack,
    });

    return {
      success: false,
      taxRecord: null,
      error: error.message,
    };
  }
}

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

export async function getTaxRecordsForDateRange(startDate, endDate, { includeVoided = false } = {}) {
  try {
    let query = supabase
      .from('tax_records')
      .select(`
        *,
        bookings (
          id,
          status,
          created_at,
          customers (
            name,
            email
          ),
          plan
        )
      `)
      .order('created_at', { ascending: false });

    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);
    if (!includeVoided) query = query.is('voided_at', null);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[getTaxRecordsForDateRange] Error:', error);
    return [];
  }
}

/** Sync missing ledger rows from paid bookings that have tax_amount set. */
export async function syncMissingTaxRecordsFromBookings() {
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, tax_amount, tax_rate_used, subtotal_before_tax, addons, delivery_type, tax_jurisdiction, status')
    .gt('tax_amount', 0);

  if (error) throw error;

  const { data: existing } = await supabase.from('tax_records').select('booking_id');
  const existingIds = new Set((existing || []).map((r) => r.booking_id));

  let synced = 0;
  for (const booking of bookings || []) {
    if (existingIds.has(booking.id)) continue;
    const result = await createTaxRecord(
      booking.id,
      Number(booking.tax_amount || 0),
      Number(booking.tax_rate_used || 0),
      Number(booking.subtotal_before_tax || 0),
      booking
    );
    if (result.success) synced += 1;
  }

  return { synced, scanned: (bookings || []).length };
}
