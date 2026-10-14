-- A paid booking waiting on documents or a cancellation decision still occupies
-- the trailer. Leaving those statuses out of booking_status_is_active dropped the
-- reservation as soon as payment finished, so the calendar accepted a second order.

CREATE OR REPLACE FUNCTION public.booking_status_is_active(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(lower(p_status), '') IN (
    'confirmed',
    'rescheduled',
    'delivered',
    'waiting_to_be_returned',
    'pending_review',
    'pending_payment',
    'pending',
    'pending_verification',
    'cancellation_pending',
    'flagged'
  );
$$;

COMMENT ON FUNCTION public.booking_status_is_active(text) IS
  'True when a booking in this status is holding inventory and must count against capacity. '
  'pending_verification and cancellation_pending keep the date until the booking is confirmed, cancelled, or finished. '
  'booking_not_finished is intentionally excluded so unfinished checkouts free dates/slots.';

SELECT public.sync_booking_reservations(id)
FROM public.bookings
WHERE lower(status) IN ('pending_verification', 'cancellation_pending');
