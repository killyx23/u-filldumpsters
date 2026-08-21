-- Stores admin follow-up resolution for flagged rentals (reason, notes, history).
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS follow_up_resolution jsonb;

COMMENT ON COLUMN public.bookings.follow_up_resolution IS
  'Admin resolution of flagged follow-up: reason, closes_flag, notes, updated_at/by, and history trail.';
