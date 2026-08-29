import { supabase } from '@/lib/customSupabaseClient';
import { buildArchiveDetails } from '@/utils/bookingArchiveHelper';

export const PAYMENT_HOLD_SESSION_KEY = 'ufill_pending_payment_hold';

/**
 * Map booking addons.equipment into RPC items for increment/decrement.
 * @param {object|null} booking
 * @returns {{ equipment_id: number, quantity: number }[]}
 */
export function getEquipmentHoldItems(booking) {
  const equipment = booking?.addons?.equipment;
  if (!Array.isArray(equipment) || equipment.length === 0) return [];

  return equipment
    .map((item) => {
      const equipmentId = Number(item.dbId || item.equipment_id || item.id);
      const quantity = Number(item.quantity || 1);
      if (!Number.isFinite(equipmentId) || equipmentId <= 0) return null;
      if (!Number.isFinite(quantity) || quantity <= 0) return null;
      return { equipment_id: equipmentId, quantity };
    })
    .filter(Boolean);
}

/**
 * True when this booking still holds inventory from unpaid checkout.
 * Supports legacy pending_payment rows created before equipment_hold_active existed.
 * Once equipment_hold_active is explicitly false, do not restock again.
 */
export function bookingHasActiveEquipmentHold(booking) {
  if (!booking) return false;
  const items = getEquipmentHoldItems(booking);
  if (items.length === 0) return false;

  // Explicitly released — never restock twice
  if (booking.addons?.equipment_hold_active === false) return false;

  if (booking.addons?.equipment_hold_active === true) return true;

  // Legacy unpaid checkout rows (no flag yet)
  return String(booking.status || '') === 'pending_payment';
}

export function rememberPaymentEquipmentHold(bookingId) {
  if (!bookingId || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      PAYMENT_HOLD_SESSION_KEY,
      JSON.stringify({ bookingId: Number(bookingId), at: new Date().toISOString() })
    );
  } catch {
    // ignore storage errors
  }
}

export function clearRememberedPaymentEquipmentHold() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PAYMENT_HOLD_SESSION_KEY);
  } catch {
    // ignore
  }
}

export function getRememberedPaymentHoldBookingId() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PAYMENT_HOLD_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const id = Number(parsed?.bookingId);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Restock equipment held for an unpaid checkout booking (idempotent).
 * Clears addons.equipment_hold_active after a successful increment.
 *
 * @param {object} booking - booking row with id, status, addons
 * @returns {Promise<{ released: boolean, error?: string }>}
 */
export async function releaseEquipmentHold(booking) {
  if (!booking?.id) return { released: false };

  if (!bookingHasActiveEquipmentHold(booking)) {
    return { released: false };
  }

  const items = getEquipmentHoldItems(booking);
  if (items.length === 0) {
    await clearHoldFlagOnly(booking);
    return { released: false };
  }

  const { error: rpcError } = await supabase.rpc('increment_equipment_quantities', {
    items_to_increment: items,
  });

  if (rpcError) {
    console.error('[releaseEquipmentHold] increment failed:', rpcError);
    return { released: false, error: rpcError.message };
  }

  const nextAddons = {
    ...(booking.addons || {}),
    equipment_hold_active: false,
  };

  const { error: updateError } = await supabase
    .from('bookings')
    .update({ addons: nextAddons })
    .eq('id', booking.id);

  if (updateError) {
    console.error('[releaseEquipmentHold] clear flag failed:', updateError);
    return { released: true, error: updateError.message };
  }

  if (getRememberedPaymentHoldBookingId() === Number(booking.id)) {
    clearRememberedPaymentEquipmentHold();
  }

  return { released: true };
}

async function clearHoldFlagOnly(booking) {
  if (booking.addons?.equipment_hold_active !== true) return;
  await supabase
    .from('bookings')
    .update({
      addons: {
        ...(booking.addons || {}),
        equipment_hold_active: false,
      },
    })
    .eq('id', booking.id);
}

/**
 * Release equipment hold and mark pending_payment booking Cancelled.
 */
export async function cancelPendingPaymentBooking(booking, { notes } = {}) {
  if (!booking?.id) return { success: false, error: 'Missing booking' };

  const releaseResult = await releaseEquipmentHold(booking);
  if (releaseResult.error && !releaseResult.released) {
    return { success: false, error: releaseResult.error };
  }

  // Re-fetch addons after release so we don't overwrite hold flag
  const { data: fresh, error: fetchError } = await supabase
    .from('bookings')
    .select('id, status, addons, created_at, total_price, payment_intent, client_secret, stripe_payment_info(*)')
    .eq('id', booking.id)
    .maybeSingle();

  if (fetchError) {
    return { success: false, error: fetchError.message };
  }

  const row = fresh || booking;
  if (String(row.status) === 'Cancelled') {
    clearRememberedPaymentEquipmentHold();
    return { success: true, alreadyCancelled: true };
  }

  // Only auto-cancel unpaid checkout holds — never touch paid bookings here
  if (String(row.status) !== 'pending_payment' && row.addons?.equipment_hold_active !== true) {
    return { success: true, skipped: true };
  }

  if (String(row.status) !== 'pending_payment') {
    clearRememberedPaymentEquipmentHold();
    return { success: true, releasedOnly: true };
  }

  const archiveDetails = buildArchiveDetails({
    action: 'cancelled',
    initiatedBy: 'customer',
    adminEmail: null,
    booking: row,
    stripeChargeId: null,
    notes: notes || 'Abandoned unpaid checkout',
  });

  const { error: updateError } = await supabase
    .from('bookings')
    .update({
      status: 'Cancelled',
      archive_details: archiveDetails,
      addons: {
        ...(row.addons || {}),
        equipment_hold_active: false,
      },
    })
    .eq('id', row.id);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  clearRememberedPaymentEquipmentHold();
  return { success: true };
}

/**
 * Load booking by id and cancel/release if it is an unpaid hold.
 */
export async function cancelPendingPaymentBookingById(bookingId, options = {}) {
  const id = Number(bookingId);
  if (!Number.isFinite(id)) return { success: false, error: 'Invalid booking id' };

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, status, addons, created_at, total_price, payment_intent, client_secret')
    .eq('id', id)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!booking) {
    clearRememberedPaymentEquipmentHold();
    return { success: true, missing: true };
  }

  return cancelPendingPaymentBooking(booking, options);
}

/**
 * Release/cancel the booking remembered in sessionStorage (leave-flow).
 */
export async function releaseRememberedPaymentEquipmentHold(options = {}) {
  const bookingId = getRememberedPaymentHoldBookingId();
  if (!bookingId) return { success: true, skipped: true };
  const result = await cancelPendingPaymentBookingById(bookingId, {
    notes: options.notes || 'Customer left booking before payment completed',
  });
  return { ...result, bookingId };
}

/**
 * After leave-early cancel: email "sorry to see you go" + feedback link.
 * Fire-and-forget safe — failures are logged, never block navigation home.
 */
export async function sendEarlyLeaveFeedbackEmail(bookingId, siteUrl = null) {
  const id = Number(bookingId);
  if (!Number.isFinite(id) || id <= 0) {
    return { success: false, skipped: true };
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-early-leave-feedback', {
      body: {
        bookingId: id,
        siteUrl: siteUrl || (typeof window !== 'undefined' ? window.location.origin : null),
      },
    });
    if (error) {
      console.warn('[early-leave-feedback] invoke failed:', error.message || error);
      return { success: false, error: error.message || String(error) };
    }
    if (data?.ok === false) {
      console.warn('[early-leave-feedback] function returned error:', data.error);
      return { success: false, error: data.error };
    }
    return { success: true, data };
  } catch (err) {
    console.warn('[early-leave-feedback] exception:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * After successful payment: keep inventory allocated, but clear the unpaid-hold flag
 * so abandon/cancel/timeout paths do not restock a paid booking.
 */
export async function clearEquipmentHoldFlagWithoutRestock(bookingId, currentAddons = null) {
  const id = Number(bookingId);
  if (!Number.isFinite(id)) return { success: false };

  let addons = currentAddons;
  if (!addons) {
    const { data } = await supabase
      .from('bookings')
      .select('addons')
      .eq('id', id)
      .maybeSingle();
    addons = data?.addons || {};
  }

  if (addons?.equipment_hold_active !== true) {
    clearRememberedPaymentEquipmentHold();
    return { success: true, skipped: true };
  }

  const { error } = await supabase
    .from('bookings')
    .update({
      addons: {
        ...addons,
        equipment_hold_active: false,
      },
    })
    .eq('id', id);

  clearRememberedPaymentEquipmentHold();

  if (error) {
    console.error('[clearEquipmentHoldFlagWithoutRestock] failed:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * After a successful decrement on payment create, mark hold active and remember it.
 */
export async function markEquipmentHoldActive(bookingId, currentAddons = {}) {
  const id = Number(bookingId);
  if (!Number.isFinite(id)) return { success: false };

  const nextAddons = {
    ...(currentAddons || {}),
    equipment_hold_active: true,
  };

  const { error } = await supabase
    .from('bookings')
    .update({ addons: nextAddons })
    .eq('id', id);

  if (error) {
    console.error('[markEquipmentHoldActive] failed:', error);
    return { success: false, error: error.message };
  }

  rememberPaymentEquipmentHold(id);
  return { success: true };
}
