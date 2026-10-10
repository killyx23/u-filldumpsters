-- One owner notice per paid booking (brandon@u-filldumpsters.com).
-- Claim-before-send so catch-up and admin resends do not repeat it.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS owner_order_notified_at timestamptz;

COMMENT ON COLUMN public.bookings.owner_order_notified_at IS
  'When the owner paid-order email was claimed. Null means not yet sent.';
