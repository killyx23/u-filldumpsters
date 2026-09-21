-- Hourly AlgoPIN uniqueness is per duration (start AND end), not start alone.
-- Igloo allows 3 variances per lock + exact startDate + exact endDate.
-- The previous OTP index on (lock_id, start_time, variance) would collide two
-- bookings that share a start hour but have different return times.

DROP INDEX IF EXISTS public.rental_access_codes_lock_start_variance_active_idx;

CREATE UNIQUE INDEX IF NOT EXISTS rental_access_codes_lock_start_end_variance_active_idx
  ON public.rental_access_codes (lock_id, start_time, end_time, variance)
  WHERE status = 'active' AND variance IS NOT NULL;
