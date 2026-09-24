-- AlgoPIN variance collision guard.
--
-- Igloo's `variance` field is meant to be a per-device, per-start-time
-- uniqueness slot (1-5): identical deviceId + startDate + variance always
-- yields the identical PIN. Production code previously derived variance from
-- rental duration (or hardcoded 1), so two bookings on the same lock with the
-- same hour-floored start could receive the exact same AlgoPIN code.
--
-- This migration:
--   1. Adds a `variance` column so the slot used for each AlgoPIN is
--      auditable (left NULL for legacy rows; every read path that matters
--      already filters `status = 'active'` before consulting existing PINs,
--      so NULL legacy/historical rows never affect new slot allocation).
--   2. Adds a partial unique index that is the actual collision guarantee:
--      no two *active* rows may share the same lock + exact start_time +
--      variance. Application code (see supabase/functions/_shared/algoPin.ts)
--      uses this to detect a losing race (23505) and retry with the next
--      free variance instead of relying solely on a racy pre-check query.

ALTER TABLE public.rental_access_codes
  ADD COLUMN IF NOT EXISTS variance smallint;

CREATE UNIQUE INDEX IF NOT EXISTS rental_access_codes_lock_start_variance_active_idx
  ON public.rental_access_codes (lock_id, start_time, variance)
  WHERE status = 'active' AND variance IS NOT NULL;
