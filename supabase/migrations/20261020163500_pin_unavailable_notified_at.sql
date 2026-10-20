ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pin_unavailable_notified_at timestamptz;

COMMENT ON COLUMN public.bookings.pin_unavailable_notified_at IS
  'When the customer was told the 5:00 AM AlgoPIN failsafe could not issue a code. Does not block a later PIN email.';
