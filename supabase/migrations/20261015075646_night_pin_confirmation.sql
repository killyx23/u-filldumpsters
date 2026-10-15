-- Pickup-morning custom PIN checks, then a 5:00 AM AlgoPIN failsafe.
-- pg_cron has no timezone, so the job runs every minute inside the UTC envelope
-- that covers midnight–5:00 AM Denver. The function ignores minutes that are
-- not on the pickup-day schedule, and still checks future drop-offs once an hour.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pin_failsafe_at timestamptz,
  ADD COLUMN IF NOT EXISTS pin_failsafe_note text;

COMMENT ON COLUMN public.bookings.pin_failsafe_at IS
  'When an AlgoPIN replaced an unconfirmed custom PIN at 5:00 AM on pickup day. Admin follow-up only.';

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $cron_setup$
DECLARE
  job RECORD;
BEGIN
  FOR job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN ('reconcile-lock-pins-hourly-denver', 'reconcile-lock-pins-night-denver')
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
END;
$cron_setup$;

SELECT cron.schedule(
  'reconcile-lock-pins-night-denver',
  '* 6-12 * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'supabase_url'
    ) || '/functions/v1/reconcile-lock-pins',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
      ),
      'apikey', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
      )
    ),
    body := jsonb_build_object('reason', 'cron'),
    timeout_milliseconds := 150000
  );
  $$
);
