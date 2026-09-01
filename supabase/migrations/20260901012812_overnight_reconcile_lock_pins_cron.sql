-- Hourly reconcile-lock-pins between 12:00–5:00 AM America/Denver.
--
-- pg_cron on this project has no timezone column, so the schedule is a UTC
-- envelope (06:00–12:00 UTC) that covers both MST and MDT. The edge function
-- no-ops ticks outside Denver hours 0–5 and sends customer PIN email/SMS only
-- at 5:00 AM Denver.
--
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $cron_setup$
DECLARE
  job RECORD;
BEGIN
  FOR job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN (
      'reconcile-lock-pins-5m',
      'reconcile-lock-pins-hourly-denver'
    )
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
END;
$cron_setup$;

SELECT cron.schedule(
  'reconcile-lock-pins-hourly-denver',
  '0 6-12 * * *',
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
