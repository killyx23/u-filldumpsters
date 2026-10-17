import { supabase } from '@/lib/customSupabaseClient';
import {
  addressesAreEqual,
  formatAddressDisplay,
  getPendingAddressChange,
  markAddressChangesApproved,
  normalizeAddress,
} from '@/utils/addressHelpers';
import { calculateAddressTrip, ensureBookingMileage } from '@/utils/bookingMileage';

const CLOSED_STATUSES = new Set(['Completed', 'Cancelled', 'flagged', 'booking_not_finished']);
const KEEP_LIVE_STATUSES = new Set([
  'Delivered',
  'waiting_to_be_returned',
  'late_return',
  'failure_to_return',
]);

export function isOpenForAddressChange(booking) {
  if (!booking || booking.returned_at) return false;
  return !CLOSED_STATUSES.has(booking.status);
}

export function addressFromCustomer(customer) {
  return normalizeAddress({
    street: customer?.street,
    city: customer?.city,
    state: customer?.state,
    zip: customer?.zip,
  });
}

export function addressFromBooking(booking) {
  return normalizeAddress(
    booking?.delivery_address ||
      booking?.contact_address || {
        street: booking?.street,
        city: booking?.city,
        state: booking?.state,
        zip: booking?.zip,
      }
  );
}

export function addonsWithTrip(addons, miles, minutes) {
  const next = addons && typeof addons === 'object' && !Array.isArray(addons) ? { ...addons } : {};
  const milesOk = Number.isFinite(Number(miles)) && Number(miles) > 0;
  const minutesOk = Number.isFinite(Number(minutes)) && Number(minutes) > 0;
  if (!milesOk) return next;
  next.oneWayDistanceMiles = Number(miles);
  next.distanceInfo = {
    ...(next.distanceInfo || {}),
    miles: Number(miles),
    duration: minutesOk ? Math.round(Number(minutes)) : next.distanceInfo?.duration ?? null,
    durationText: minutesOk ? `${Math.round(Number(minutes))} mins` : next.distanceInfo?.durationText,
  };
  return next;
}

export function appendAddressHistory(history, entry) {
  const list = Array.isArray(history) ? [...history] : [];
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${list.length}`;
  list.push({ id, ...entry });
  return list;
}

export function settlePendingAddressHistory(history, { status, resolvedAt, toDisplay }) {
  const target = String(toDisplay || '').toLowerCase();
  return (Array.isArray(history) ? history : []).map((entry) => {
    if (entry?.status !== 'pending') return entry;
    const entryTo = formatAddressDisplay(entry.to_address).toLowerCase();
    if (target && entryTo && entryTo !== target) return entry;
    return { ...entry, status, resolved_at: resolvedAt };
  });
}

function ensureOrderSnapshot(history, booking) {
  const list = Array.isArray(history) ? [...history] : [];
  const already = list.some(
    (entry) => entry?.source === 'order' && Number(entry.booking_id) === Number(booking.id)
  );
  if (already) return list;
  const original = addressFromBooking(booking);
  if (!original) return list;
  return appendAddressHistory(list, {
    source: 'order',
    status: 'recorded',
    address: original,
    booking_id: booking.id,
    recorded_at: booking.created_at || new Date().toISOString(),
  });
}

export function statusAfterAddressDecision(booking) {
  if (!booking) return null;
  if (booking.delivered_at || KEEP_LIVE_STATUSES.has(booking.status)) return booking.status;
  if (booking.status === 'pending_review') return 'Confirmed';
  return booking.status;
}

function addressPayload(address, manual) {
  return {
    street: address.street,
    city: address.city,
    state: address.state,
    zip: address.zip,
    formatted_address: address.formatted_address,
    isVerified: !manual,
  };
}

async function measure(address) {
  const display = formatAddressDisplay(address);
  try {
    return await calculateAddressTrip(display);
  } catch (error) {
    console.warn('[addressChangeReview] trip calc failed:', error);
    return { miles: null, minutes: null };
  }
}

export async function applyApprovedAddress({
  customer,
  booking,
  toAddress,
  fromAddress = null,
  pendingEntry = null,
  approvedAt = new Date().toISOString(),
  scheduleStillPending = false,
  historyAlreadyUpdated = null,
  source = 'address_change',
  adminLabel = null,
}) {
  const manual = Boolean(pendingEntry?.is_manual_address);
  const payload = addressPayload(toAddress, manual);
  const trip = await measure(toAddress);
  const miles = trip.miles ?? (Number(pendingEntry?.distance_miles) > 0 ? Number(pendingEntry.distance_miles) : null);
  const minutes = trip.minutes;

  const nextHistory = historyAlreadyUpdated || markAddressChangesApproved(booking.reschedule_history, approvedAt);
  const bookingUpdate = {
    street: toAddress.street,
    city: toAddress.city,
    state: toAddress.state,
    zip: toAddress.zip,
    delivery_address: payload,
    contact_address: payload,
    reschedule_history: nextHistory,
    ...(adminLabel ? { address_verified_by_admin: adminLabel } : {}),
    address_verified_date: approvedAt,
    pending_address_verification: false,
    addons: addonsWithTrip(booking.addons, miles, minutes),
  };
  if (miles) bookingUpdate.distance_miles = miles;

  const nextStatus = statusAfterAddressDecision(booking);
  if (!scheduleStillPending && nextStatus && nextStatus !== booking.status) {
    bookingUpdate.status = nextStatus;
  }

  const { error } = await supabase.from('bookings').update(bookingUpdate).eq('id', booking.id);
  if (error) throw error;

  const toDisplay = formatAddressDisplay(toAddress);
  let history = ensureOrderSnapshot(customer.address_history, booking);
  history = settlePendingAddressHistory(history, {
    status: 'approved',
    resolvedAt: approvedAt,
    toDisplay,
  });
  const alreadyApproved = history.some(
    (entry) =>
      entry.status === 'approved' &&
      Number(entry.booking_id) === Number(booking.id) &&
      formatAddressDisplay(entry.to_address).toLowerCase() === toDisplay.toLowerCase() &&
      entry.resolved_at === approvedAt
  );
  if (!alreadyApproved) {
    history = appendAddressHistory(history, {
      source: pendingEntry?.source || source,
      status: 'approved',
      from_address: fromAddress,
      to_address: toAddress,
      booking_id: booking.id,
      requested_at: pendingEntry?.requested_at || approvedAt,
      resolved_at: approvedAt,
    });
  }

  const customerUpdate = {
    street: toAddress.street,
    city: toAddress.city,
    state: toAddress.state,
    zip: toAddress.zip,
    unverified_address: manual,
    address_history: history,
    pending_address: null,
    distance_miles: miles,
    travel_time_minutes: minutes,
  };
  await supabase.from('customers').update(customerUpdate).eq('id', customer.id);

  await ensureBookingMileage(
    { ...booking, ...bookingUpdate, id: booking.id, customer_id: customer.id },
    {
      customer: { ...customer, ...customerUpdate },
      oneWayMilesOverride: miles,
      source,
      recalculateIfMissing: !miles,
    }
  );

  if ((pendingEntry?.source || source) === 'profile') {
    await applySameAddressToOpenBookings({
      customer: { ...customer, ...customerUpdate },
      exceptBookingId: booking.id,
      toAddress,
      miles,
      minutes,
      approvedAt,
      manual,
    });
  }

  return { bookingUpdate, customerUpdate, miles, minutes, toDisplay };
}

async function applySameAddressToOpenBookings({
  customer,
  exceptBookingId,
  toAddress,
  miles,
  minutes,
  approvedAt,
  manual,
}) {
  const { data: rows } = await supabase.from('bookings').select('*').eq('customer_id', customer.id);
  const payload = addressPayload(toAddress, manual);
  for (const row of rows || []) {
    if (Number(row.id) === Number(exceptBookingId) || !isOpenForAddressChange(row)) continue;
    const pending = getPendingAddressChange(row.reschedule_history);
    if (pending && !addressesAreEqual(pending.to_address, toAddress)) continue;
    const update = {
      street: toAddress.street,
      city: toAddress.city,
      state: toAddress.state,
      zip: toAddress.zip,
      delivery_address: payload,
      contact_address: payload,
      addons: addonsWithTrip(row.addons, miles, minutes),
      pending_address_verification: false,
    };
    if (miles) update.distance_miles = miles;
    if (pending) update.reschedule_history = markAddressChangesApproved(row.reschedule_history, approvedAt);
    const nextStatus = statusAfterAddressDecision(row);
    if (pending && nextStatus && nextStatus !== row.status && !hasOtherPendingSchedule(row)) {
      update.status = nextStatus;
    }
    await supabase.from('bookings').update(update).eq('id', row.id);
    await ensureBookingMileage(
      { ...row, ...update },
      { customer, oneWayMilesOverride: miles, source: 'profile_address', recalculateIfMissing: !miles }
    );
  }
}

function hasOtherPendingSchedule(booking) {
  const history = Array.isArray(booking?.reschedule_history) ? booking.reschedule_history : [];
  return history.some((entry) => entry?.type === 'reschedule_request' && entry?.status === 'pending');
}

export async function denyPendingAddress({ customer, booking, pendingEntry, deniedAt = new Date().toISOString() }) {
  const toDisplay = formatAddressDisplay(pendingEntry?.to_address);
  const history = Array.isArray(booking?.reschedule_history) ? booking.reschedule_history : [];
  const nextHistory = history.map((entry) => {
    if (entry?.type === 'address_change' && entry?.status === 'pending') {
      return { ...entry, status: 'denied', resolved_at: deniedAt };
    }
    return entry;
  });
  const bookingUpdate = { reschedule_history: nextHistory, pending_address_verification: false };
  const nextStatus = statusAfterAddressDecision(booking);
  if (nextStatus && nextStatus !== booking.status && !hasOtherPendingSchedule(booking)) {
    bookingUpdate.status = nextStatus;
  }
  const { error } = await supabase.from('bookings').update(bookingUpdate).eq('id', booking.id);
  if (error) throw error;

  const customerHistory = settlePendingAddressHistory(customer.address_history, {
    status: 'denied',
    resolvedAt: deniedAt,
    toDisplay,
  });
  await supabase
    .from('customers')
    .update({ address_history: customerHistory, pending_address: null })
    .eq('id', customer.id);

  return { toDisplay, fromDisplay: formatAddressDisplay(pendingEntry?.from_address) || 'N/A' };
}

export async function notifyAddressDecision({ customer, bookingId, decision, fromDisplay, toDisplay }) {
  const approved = decision === 'approved';
  const content = approved
    ? `Address approved${bookingId ? ` for booking #${bookingId}` : ''}.\nFrom: ${fromDisplay}\nTo: ${toDisplay}\nStatus: Address verified.`
    : `Address change was not approved${bookingId ? ` for booking #${bookingId}` : ''}.\nRequested: ${toDisplay}\nThe address on file stays: ${fromDisplay}`;

  await supabase.from('customer_notes').insert({
    customer_id: customer.id,
    booking_id: bookingId || null,
    source: 'Address Change',
    content,
    author_type: 'admin',
    is_read: true,
  });
  await supabase.from('chat_messages').insert({
    conversation_id: `cust_${customer.id}`,
    customer_id: customer.id,
    booking_id: bookingId || null,
    sender_type: 'admin',
    message_content: content,
    is_read: false,
    message_severity: approved ? 'success' : 'warning',
    message_context: { action: approved ? 'address_approved' : 'address_denied', booking_id: bookingId || null },
  });

  await supabase.functions.invoke('send-reschedule-confirmation-email', {
    body: {
      bookingId: bookingId || undefined,
      customerId: customer.id,
      emailType: approved ? 'address_approved' : 'address_denied',
      fromAddress: fromDisplay,
      toAddress: toDisplay,
    },
  });
}

export function collectAddressHistory(customer, bookings = []) {
  const rows = [];
  for (const entry of Array.isArray(customer?.address_history) ? customer.address_history : []) {
    rows.push(entry);
  }
  for (const booking of bookings || []) {
    const history = Array.isArray(booking.reschedule_history) ? booking.reschedule_history : [];
    for (const entry of history) {
      if (entry?.type !== 'address_change') continue;
      rows.push({
        source: entry.source || 'reschedule',
        status: entry.status,
        from_address: entry.from_address,
        to_address: entry.to_address,
        booking_id: booking.id,
        requested_at: entry.requested_at,
        resolved_at: entry.approved_at || entry.resolved_at || null,
      });
    }
    const original = addressFromBooking(booking);
    if (original) {
      rows.push({
        source: 'order',
        status: 'recorded',
        address: original,
        booking_id: booking.id,
        recorded_at: booking.created_at,
      });
    }
  }

  const seen = new Set();
  return rows
    .filter((entry) => {
      const key = entry.source === 'order'
        ? ['order', entry.booking_id || '', formatAddressDisplay(entry.address || entry.from_address)].join('|')
        : [
            entry.source,
            entry.status,
            entry.booking_id || '',
            formatAddressDisplay(entry.address || entry.from_address),
            formatAddressDisplay(entry.to_address),
            entry.requested_at || entry.recorded_at || '',
          ].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aTime = new Date(a.resolved_at || a.requested_at || a.recorded_at || 0).getTime();
      const bTime = new Date(b.resolved_at || b.requested_at || b.recorded_at || 0).getTime();
      return bTime - aTime;
    });
}
