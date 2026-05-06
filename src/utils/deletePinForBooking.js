import { supabase } from '@/lib/customSupabaseClient';

const PIN_DELETE_STATUSES = new Set(['Cancelled', 'pending_review']);

export const shouldDeletePinForStatus = (status) => PIN_DELETE_STATUSES.has(status);

export const isTrailerOrDumpLoaderRental = (booking = {}) => {
  const plan = booking.plan || booking.addons?.plan || booking.plans || {};
  const planId = Number(plan.id ?? booking.plan_id);
  const planName = String(plan.name || booking.plan_name || '').toLowerCase();

  return (
    planId === 2 ||
    planName.includes('dump loader') ||
    planName.includes('dump trailer') ||
    planName.includes('loader trailer') ||
    planName.includes('trailer')
  );
};

export const deletePinForBooking = (booking, callerType) => {
  if (!booking?.id || !isTrailerOrDumpLoaderRental(booking)) return;

  supabase.functions.invoke('delete-pin', {
    body: {
      bookingId: booking.id,
      callerType,
    },
  }).then(({ data, error }) => {
    if (error) {
      console.warn('[delete-pin] PIN deletion request failed:', error.message);
      return;
    }

    if (data && data.dbExpired !== true) {
      console.warn('[delete-pin] PIN deletion did not confirm database expiry:', data);
    }
  }).catch((error) => {
    console.warn('[delete-pin] PIN deletion request failed:', error.message);
  });
};
