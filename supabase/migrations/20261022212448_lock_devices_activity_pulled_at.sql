-- Rate-limit jobType 15 GET_LOGS pulls. The 5-minute cron still ticks, but
-- sync-lock-activity skips the radio when this timestamp is less than an hour old.

ALTER TABLE public.lock_devices
  ADD COLUMN IF NOT EXISTS activity_pulled_at timestamptz;

COMMENT ON COLUMN public.lock_devices.activity_pulled_at IS
  'When sync-lock-activity last queued a bridge GET_LOGS job for this lock.';
