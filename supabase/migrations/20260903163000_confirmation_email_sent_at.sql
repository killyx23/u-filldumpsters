-- Idempotency flag for booking confirmation emails (claim-before-send).
-- Prevents finalize-booking catch-up / remount races from sending duplicates.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS confirmation_email_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.confirmation_email_sent_at IS
  'When the booking confirmation email was claimed/sent. Null means not yet sent. Used for send-once idempotency.';
