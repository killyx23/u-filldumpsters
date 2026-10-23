-- The lock-close timestamp that registered the return. Fee math uses this
-- time, which stays put if returned_at is later edited by a yard mark.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS return_lock_at timestamptz;

COMMENT ON COLUMN public.bookings.return_lock_at IS
  'Timestamp of the lock close that registered the return. Used for fee calculation.';

UPDATE public.bookings AS b
SET return_lock_at = b.returned_at
WHERE b.return_lock_at IS NULL
  AND b.returned_at IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.rental_tracking_logs AS l
    WHERE l.order_id = b.id
      AND l.event_type = 'lock'
      AND l.event_timestamp = b.returned_at
  );
