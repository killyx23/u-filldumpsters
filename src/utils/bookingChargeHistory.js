import { supabase } from '@/lib/customSupabaseClient';

/**
 * Persist charge history rows for a booking.
 * Each entry should contain: charge_key, charge_name, charge_description, amount, metadata.
 */
export async function logBookingChargeHistory(bookingId, entries = [], sourceContext = 'admin_manual') {
  const normalized = (entries || [])
    .filter((entry) => Number(entry?.amount || 0) > 0)
    .map((entry) => ({
      booking_id: bookingId,
      charge_key: entry.charge_key,
      charge_name: entry.charge_name,
      charge_description: entry.charge_description || null,
      charge_amount: Number(entry.amount),
      charge_source: sourceContext,
      metadata: entry.metadata || {},
      created_at: new Date().toISOString(),
    }));

  if (normalized.length === 0) return { success: true };

  const { error } = await supabase.from('booking_charge_transactions').insert(normalized);
  if (error) {
    return { success: false, error };
  }
  return { success: true };
}

