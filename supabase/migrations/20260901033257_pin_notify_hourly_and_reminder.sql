-- First PIN email at drop-off minus 12h and 1h reminder, via hourly notify-only
-- reconcile-lock-pins ({ reason: 'notify' }). Overnight lock cron is unchanged.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pin_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.pin_reminder_sent_at IS
  'When the 1-hour-before PIN reminder email/SMS was sent.';

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $cron_setup$
DECLARE
  job RECORD;
BEGIN
  FOR job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN ('reconcile-lock-pins-notify-hourly')
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
END;
$cron_setup$;

SELECT cron.schedule(
  'reconcile-lock-pins-notify-hourly',
  '0 * * * *',
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
    body := jsonb_build_object('reason', 'notify'),
    timeout_milliseconds := 60000
  );
  $$
);
