import { supabase } from '@/lib/customSupabaseClient';
import {
  calculateDistanceViaGoogleMaps,
  formatFullAddress,
  getBusinessAddress,
} from '@/utils/distanceCalculationHelper';

/**
 * Company drives to the customer (delivery services).
 */
export function bookingIsCompanyDelivery(booking) {
  if (!booking) return false;
  const addons = booking.addons || {};
  if (addons.isDelivery || addons.deliveryService) return true;

  const plan = booking.plan || {};
  const planId = Number(plan.id);
  const name = String(plan.name || '').toLowerCase();

  if (planId === 1 || planId === 4) return true;
  if (planId === 2 && addons.isDelivery) return true;
  if (name.includes('delivery')) return true;
  return false;
}

/**
 * @deprecated Use shouldLogBookingMileage — kept for call sites expecting delivery-trip naming.
 */
export function bookingHasDeliveryTrip(booking) {
  return shouldLogBookingMileage(booking);
}

/**
 * Log in Financial Books whenever one-way miles are known (incl. self-pickup).
 */
export function shouldLogBookingMileage(booking, customer = null) {
  return resolveOneWayMiles(booking, customer) > 0;
}

/**
 * Prefer stored one-way miles: booking → customer → addons.oneWayDistanceMiles.
 * Does not use 3-leg deliveryDistance (billing route).
 */
export function resolveOneWayMiles(booking, customer = null) {
  const fromBooking = Number(booking?.distance_miles);
  if (Number.isFinite(fromBooking) && fromBooking > 0) return fromBooking;

  const fromCustomer = Number(customer?.distance_miles ?? booking?.customers?.distance_miles);
  if (Number.isFinite(fromCustomer) && fromCustomer > 0) return fromCustomer;

  const fromAddons = Number(booking?.addons?.oneWayDistanceMiles ?? booking?.addons?.distanceInfo?.miles);
  if (Number.isFinite(fromAddons) && fromAddons > 0) return fromAddons;

  return 0;
}

export function formatMilesLabel(miles) {
  const n = Number(miles);
  if (!Number.isFinite(n) || n <= 0) return 'N/A';
  return `${n.toFixed(1)} mi`;
}

function addressSnapshotFromBooking(booking) {
  if (booking?.delivery_address) return booking.delivery_address;
  return {
    street: booking?.street || '',
    city: booking?.city || '',
    state: booking?.state || '',
    zip: booking?.zip || '',
    formatted_address:
      booking?.delivery_address?.formatted_address ||
      [booking?.street, booking?.city, booking?.state, booking?.zip].filter(Boolean).join(', '),
  };
}

/**
 * Upsert Financial Books mileage log via SECURITY DEFINER RPC.
 */
export async function upsertBookingMileageLog({
  bookingId,
  oneWayMiles = null,
  source = 'booking_create',
  addressSnapshot = null,
} = {}) {
  if (!bookingId) return { data: null, error: new Error('bookingId required') };

  const { data, error } = await supabase.rpc('upsert_booking_mileage_log', {
    p_booking_id: bookingId,
    p_one_way_miles: oneWayMiles != null && oneWayMiles !== '' ? Number(oneWayMiles) : null,
    p_source: source,
    p_address_snapshot: addressSnapshot,
  });

  return { data, error };
}

/**
 * Calculate one-way Google miles for an address string.
 */
export async function calculateOneWayMilesForAddress(addressString) {
  if (!addressString || String(addressString).trim().length < 8) {
    return null;
  }
  const origin = await getBusinessAddress();
  const result = await calculateDistanceViaGoogleMaps(origin, addressString);
  const miles = Number(result?.distance);
  return Number.isFinite(miles) && miles > 0 ? miles : null;
}

/**
 * Ensure booking has one-way miles stored and a Financial Books mileage log when miles are known.
 */
export async function ensureBookingMileage(booking, {
  customer = null,
  oneWayMilesOverride = null,
  source = 'booking_create',
  recalculateIfMissing = false,
} = {}) {
  if (!booking?.id) return { oneWayMiles: 0, logId: null, error: new Error('booking required') };

  let oneWay =
    oneWayMilesOverride != null && Number(oneWayMilesOverride) > 0
      ? Number(oneWayMilesOverride)
      : resolveOneWayMiles(booking, customer);

  if ((!oneWay || oneWay <= 0) && recalculateIfMissing) {
    const addr =
      booking.delivery_address?.formatted_address ||
      formatFullAddress(booking.delivery_address) ||
      formatFullAddress(customer) ||
      formatFullAddress(booking);
    try {
      oneWay = (await calculateOneWayMilesForAddress(addr)) || 0;
    } catch (err) {
      console.warn('[bookingMileage] one-way calc failed:', err);
    }
  }

  if (oneWay > 0) {
    const { error: updateErr } = await supabase
      .from('bookings')
      .update({ distance_miles: oneWay })
      .eq('id', booking.id);
    if (updateErr) {
      console.warn('[bookingMileage] failed to update bookings.distance_miles:', updateErr);
    }

    if (customer?.id || booking.customer_id) {
      await supabase
        .from('customers')
        .update({ distance_miles: oneWay })
        .eq('id', customer?.id || booking.customer_id);
    }
  }

  if (!(oneWay > 0)) {
    return { oneWayMiles: 0, logId: null, error: null };
  }

  const { data: logId, error } = await upsertBookingMileageLog({
    bookingId: booking.id,
    oneWayMiles: oneWay,
    source,
    addressSnapshot: addressSnapshotFromBooking(booking),
  });

  return { oneWayMiles: oneWay, logId, error };
}
